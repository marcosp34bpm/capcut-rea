/**
 * Draft renderer.
 *
 * Renders the canonical native draft to a video file using the FFmpeg binary
 * shipped with the local CapCut installation.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { NativeError } from "./editor.mjs";
import { durationOf, planRender, resolveFfmpeg, segmentMaterial, trackSegments } from "./render.mjs";
import { renderTextOverlay } from "./text-overlay.mjs";

/**
 * Read the text layers declared by a draft.
 *
 * @param {object} draft canonical native draft
 * @returns {object[]} the text layers with their decoded content
 */
export const textLayers = (draft) => {
  const layers = [];
  for (const track of draft.tracks ?? []) {
    if (track.type !== "text") continue;
    for (const segment of trackSegments(track)) {
      const material = segmentMaterial(draft, segment);
      if (material === null) continue;
      const text = decodeTextContent(material.content);
      if (text.length === 0) continue;
      layers.push({
        text,
        startUs: segment.target_timerange?.start ?? 0,
        durationUs: segment.target_timerange?.duration ?? 0,
        fontSize: material.font_size ?? 15,
        align: material.alignment ?? 1,
      });
    }
  }
  return layers;
};

/**
 * Decode the styled text content stored in a text material.
 *
 * @param {string | object} content the raw material content
 * @returns {string} the plain text
 */
export const decodeTextContent = (content) => {
  if (typeof content === "object" && content !== null) {
    return typeof content.text === "string" ? content.text : "";
  }
  if (typeof content !== "string") return "";
  try {
    const parsed = JSON.parse(content);
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return content;
  }
};

/**
 * Render one draft to a video file.
 *
 * @param {object} draft canonical native draft
 * @param {Record<string, unknown>} options render options
 * @returns {Promise<Record<string, unknown>>} the render result
 */
export const renderDraft = async (draft, options = {}) => {
  const capcutRoot = options.capcutRoot ?? process.env.CAPCUT_ROOT;
  if (capcutRoot === undefined) {
    throw new NativeError(
      "render_no_capcut_root",
      "CAPCUT_ROOT is required to locate the shipped ffmpeg binary",
      {},
    );
  }
  const ffmpeg = resolveFfmpeg(capcutRoot);
  const output = options.output ?? join(tmpdir(), `capcut-render-${Date.now()}.mp4`);
  await mkdir(dirname(output), { recursive: true });

  const overlayDirectory =
    options.overlayDirectory ?? join(dirname(output), "capcut-overlays");
  await mkdir(overlayDirectory, { recursive: true });

  const overlays = [];
  const layers = textLayers(draft);
  for (const [index, layer] of layers.entries()) {
    const scale = Math.max(2, Math.round(layer.fontSize / 4));
    const rendered = await renderTextOverlay({
      text: layer.text,
      scale,
      path: join(overlayDirectory, `text-${index}.png`),
      color: [255, 255, 255, 255],
    });
    const { width, height } = canvasOf(draft);
    overlays.push({
      path: rendered.path,
      width: rendered.width,
      height: rendered.height,
      x: layer.align === 0 ? 40 : Math.round(width / 2 - rendered.width / 2),
      y: Math.round(height / 2 - rendered.height / 2),
      startUs: layer.startUs,
      durationUs: layer.durationUs,
    });
  }

  const plan = planRender(draft, { output, overlays, encoder: options.encoder });
  const result = await runFfmpeg(ffmpeg, plan.args);
  return {
    output,
    encoder: options.encoder ?? plan.args[plan.args.indexOf("-c:v") + 1],
    durationUs: durationOf(draft),
    warnings: plan.warnings,
    textLayers: layers.length,
    ffmpeg: result,
  };
};

/**
 * Read the canvas size of a draft.
 *
 * @param {object} draft canonical native draft
 * @returns {{ width: number, height: number }} the canvas size
 */
const canvasOf = (draft) => ({
  width: draft.canvas_config?.width ?? 1920,
  height: draft.canvas_config?.height ?? 1080,
});

/**
 * Run FFmpeg and collect its result.
 *
 * @param {string} ffmpeg the ffmpeg binary
 * @param {string[]} args the argument list
 * @returns {Promise<Record<string, unknown>>} the run result
 */
export const runFfmpeg = (ffmpeg, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (cause) => {
      reject(
        new NativeError("render_spawn_failed", cause.message, {
          ffmpeg,
        }),
      );
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ code, stderr: stderr.slice(-4000) });
        return;
      }
      reject(
        new NativeError("render_failed", `ffmpeg exited with code ${code}`, {
          code,
          stderr: stderr.slice(-4000),
          args,
        }),
      );
    });
  });
