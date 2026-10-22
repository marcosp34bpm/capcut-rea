/**
 * Draft-to-FFmpeg planner.
 *
 * Turns the canonical native draft into an FFmpeg command that renders the
 * timeline. The shipped CapCut `ffmpeg.exe` is used: it carries NVENC, AMF,
 * QSV and MediaFoundation encoders plus the full decode set.
 *
 * The shipped build has no `drawtext` filter (it is compiled without
 * libfreetype), so text layers are rendered as PNG overlays produced by
 * `text-overlay.mjs` and composited with the `overlay` filter.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** Video encoders the shipped build offers, best first. */
export const VIDEO_ENCODERS = ["h264_nvenc", "h264_amf", "h264_qsv", "h264_mf"];

/**
 * Resolve the shipped FFmpeg binary.
 *
 * @param {string} capcutRoot CapCut installation root
 * @returns {string} the ffmpeg path
 */
export const resolveFfmpeg = (capcutRoot) => join(capcutRoot, "ffmpeg.exe");

/**
 * Collect the segments of one track in timeline order.
 *
 * @param {object} track one draft track
 * @returns {object[]} the ordered segments
 */
export const trackSegments = (track) =>
  [...(track.segments ?? [])].sort(
    (left, right) =>
      (left.target_timerange?.start ?? 0) - (right.target_timerange?.start ?? 0),
  );

/**
 * Resolve the media file behind one segment.
 *
 * @param {object} draft canonical native draft
 * @param {object} segment one draft segment
 * @returns {object | null} the material, when it resolves
 */
export const segmentMaterial = (draft, segment) => {
  const materialId = segment.material_id;
  const pools = [
    draft.materials?.videos,
    draft.materials?.audios,
    draft.materials?.images,
    draft.materials?.stickers,
    draft.materials?.texts,
  ];
  for (const pool of pools) {
    const found = (pool ?? []).find((candidate) => candidate.id === materialId);
    if (found !== undefined) return found;
  }
  return null;
};

/**
 * Convert microseconds to the `HH:MM:SS.mmm` form FFmpeg accepts.
 *
 * @param {number} microseconds duration in microseconds
 * @returns {string} the FFmpeg timestamp
 */
export const toTimestamp = (microseconds) => {
  const total = Math.max(0, microseconds) / 1_000_000;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
};

/**
 * Convert microseconds to a plain seconds string.
 *
 * The `overlay` filter parses its options on colons, so a timestamp such as
 * `00:00:03.000` inside an `enable` expression would be split into separate
 * options. Seconds keep the expression in one piece.
 *
 * @param {number} microseconds duration in microseconds
 * @returns {string} the seconds string
 */
export const toSeconds = (microseconds) =>
  (Math.max(0, microseconds) / 1_000_000).toFixed(3);

/**
 * Build the `between` expression that enables a layer over its time range.
 *
 * Commas are escaped because FFmpeg splits a filter chain on commas.
 *
 * @param {number} startUs range start in microseconds
 * @param {number} endUs range end in microseconds
 * @returns {string} the enable expression
 */
export const between = (startUs, endUs) =>
  `between(t\\,${toSeconds(startUs)}\\,${toSeconds(endUs)})`;

/**
 * Read the canvas size declared by the draft.
 *
 * @param {object} draft canonical native draft
 * @returns {{ width: number, height: number }} the canvas size
 */
export const canvasSize = (draft) => ({
  width: draft.canvas_config?.width ?? 1920,
  height: draft.canvas_config?.height ?? 1080,
});

/**
 * Read the background color declared by the draft.
 *
 * @param {object} draft canonical native draft
 * @returns {string} an FFmpeg color expression
 */
export const backgroundColor = (draft) => {
  const background = draft.canvas_config?.background;
  const color = background?.color ?? background;
  if (typeof color !== "string" || color.trim().length === 0) return "black";
  return color.startsWith("#") ? color : `#${color}`;
};

/**
 * Read the declared frame rate.
 *
 * @param {object} draft canonical native draft
 * @returns {number} frames per second
 */
export const frameRate = (draft) => draft.fps ?? 30;

/**
 * Compute the timeline duration of a draft.
 *
 * @param {object} draft canonical native draft
 * @returns {number} the duration in microseconds
 */
export const durationOf = (draft) => {
  let end = 0;
  for (const track of draft.tracks ?? []) {
    for (const segment of track.segments ?? []) {
      const start = segment.target_timerange?.start ?? 0;
      const duration = segment.target_timerange?.duration ?? 0;
      end = Math.max(end, start + duration);
    }
  }
  return end === 0 ? (draft.duration ?? 0) : end;
};

/**
 * Build the FFmpeg argument list that renders the draft.
 *
 * @param {object} draft canonical native draft
 * @param {Record<string, unknown>} options render options
 * @returns {{ args: string[], warnings: string[], durationUs: number }} the plan
 */
export const planRender = (draft, options = {}) => {
  const inputs = [];
  const filters = [];
  const warnings = [];
  const { width, height } = canvasSize(draft);
  const fps = frameRate(draft);
  const encoder = options.encoder ?? VIDEO_ENCODERS[0];
  const overlays = options.overlays ?? [];
  const background = backgroundColor(draft);

  // The base canvas is a generated color source.
  inputs.push({ kind: "lavfi", value: `color=c=${background}:s=${width}x${height}:r=${fps}` });

  const videoTracks = (draft.tracks ?? []).filter(
    (track) => track.type === "video" || track.type === "sticker",
  );
  const audioTracks = (draft.tracks ?? []).filter(
    (track) => track.type === "audio",
  );

  const usable = (track) =>
    trackSegments(track).filter((segment) => {
      const material = segmentMaterial(draft, segment);
      const path = material?.path;
      if (typeof path !== "string" || path.length === 0) return false;
      if (!existsSync(path)) {
        warnings.push(`media not found: ${path}`);
        return false;
      }
      return true;
    });

  let inputIndex = 1;
  let labelIndex = 0;
  const nextLabel = (prefix) => `${prefix}${labelIndex++}`;

  // Base canvas layer.
  const baseLabel = nextLabel("base");
  filters.push(
    `[0:v]scale=${width}:${height},setsar=1,format=rgba[${baseLabel}]`,
  );
  let current = baseLabel;

  // Video and sticker segments.
  for (const track of videoTracks) {
    for (const segment of usable(track)) {
      const material = segmentMaterial(draft, segment);
      const sourceStart = segment.source_timerange?.start ?? 0;
      const sourceDuration = segment.source_timerange?.duration ?? 0;
      const targetStart = segment.target_timerange?.start ?? 0;
      const targetDuration = segment.target_timerange?.duration ?? sourceDuration;
      const clip = segment.clip ?? {};
      const rotation = clip.rotation ?? 0;

      inputs.push({ kind: "file", value: material.path });
      const input = inputIndex;
      inputIndex += 1;

      const chain = [
        `trim=start=${toTimestamp(sourceStart)}:end=${toTimestamp(sourceStart + sourceDuration)}`,
        "setpts=PTS-STARTPTS",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
      ];
      if (rotation !== 0) chain.push(`rotate=${rotation * (180 / Math.PI)}`);
      chain.push("format=rgba");
      const label = nextLabel("v");
      filters.push(`[${input}:v]${chain.join(",")}[${label}]`);

      const composed = nextLabel("c");
      filters.push(
        `[${current}][${label}]overlay=x=0:y=0:enable='${between(targetStart, targetStart + targetDuration)}'[${composed}]`,
      );
      current = composed;
    }
  }

  // Text and image overlays rendered as PNG.
  for (const overlay of overlays) {
    inputs.push({ kind: "file", value: overlay.path });
    const input = inputIndex;
    inputIndex += 1;
    const label = nextLabel("o");
    filters.push(
      `[${input}:v]format=rgba,scale=${overlay.width}:${overlay.height}[${label}]`,
    );
    const composed = nextLabel("c");
    filters.push(
      `[${current}][${label}]overlay=x=${overlay.x}:y=${overlay.y}:enable='${between(overlay.startUs, overlay.startUs + overlay.durationUs)}'[${composed}]`,
    );
    current = composed;
  }

  filters.push(`[${current}]format=yuv420p[vout]`);

  // Audio segments.
  const audioLabels = [];
  for (const track of audioTracks) {
    for (const segment of usable(track)) {
      const material = segmentMaterial(draft, segment);
      const sourceStart = segment.source_timerange?.start ?? 0;
      const sourceDuration = segment.source_timerange?.duration ?? 0;
      const targetStart = segment.target_timerange?.start ?? 0;
      inputs.push({ kind: "file", value: material.path });
      const input = inputIndex;
      inputIndex += 1;
      const label = nextLabel("a");
      const delay = Math.round(targetStart / 1000);
      filters.push(
        `[${input}:a]atrim=start=${toTimestamp(sourceStart)}:end=${toTimestamp(sourceStart + sourceDuration)},asetpts=PTS-STARTPTS,adelay=${delay}|${delay}[${label}]`,
      );
      audioLabels.push(label);
    }
  }

  let audioOutput = null;
  if (audioLabels.length === 1) {
    audioOutput = audioLabels[0];
  } else if (audioLabels.length > 1) {
    filters.push(
      `${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${audioLabels.length}:normalize=0[aout]`,
    );
    audioOutput = "aout";
  }

  const durationUs = durationOf(draft);

  const args = [];
  for (const input of inputs) {
    if (input.kind === "lavfi") {
      args.push("-f", "lavfi", "-i", input.value);
      continue;
    }
    args.push("-i", input.value);
  }
  args.push("-filter_complex", filters.join(";"));
  args.push("-map", "[vout]");
  if (audioOutput !== null) args.push("-map", `[${audioOutput}]`);
  args.push("-c:v", encoder);
  if (encoder.startsWith("h264_nvenc")) args.push("-preset", "p4");
  if (audioOutput !== null) args.push("-c:a", "aac", "-b:a", "192k");
  args.push("-pix_fmt", "yuv420p");
  args.push("-movflags", "+faststart");
  if (durationUs > 0) args.push("-t", toTimestamp(durationUs));
  args.push("-y", options.output);

  return { args, warnings, durationUs };
};

