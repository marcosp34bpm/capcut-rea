/**
 * Timeline engine for the reconstructed CapCut editor.
 *
 * Method names here follow the shipped `videoeditor_addon.node` surface
 * recovered by REA, so the reconstructed editor exposes the same vocabulary an
 * agent integration would have called against the real product.
 */

import {
  ContractError,
  assertRevision,
  findAsset,
  findTimelineOfTrack,
  findTrack,
  pushHistory,
} from "./draft.mjs";

/**
 * Create one track.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options track options
 * @returns {object} the created track
 */
export function addTrack(draft, options) {
  const type = options.type ?? "video";
  if (!["video", "audio", "text", "sticker", "effect"].includes(type)) {
    throw new ContractError(
      "editor.track.invalid-type",
      `unsupported track type: ${type}`,
      { type },
    );
  }
  const track = {
    id: options.id ?? `track-${draft.tracks.length + 1}`,
    name: options.name ?? `Track ${draft.tracks.length + 1}`,
    type,
    segments: [],
    locked: false,
    muted: false,
  };
  draft.tracks.push(track);
  const timeline = draft.timelines[draft.mainTimelineId];
  if (timeline !== undefined) timeline.trackIds.push(track.id);
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return track;
}

/**
 * Add a media segment to a track.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options segment options
 * @returns {object} the created segment
 */
export function addVideo(draft, options) {
  const track = findTrack(draft, options.trackId);
  if (track === undefined) {
    throw new ContractError(
      "editor.track.not-found",
      `track not found: ${options.trackId}`,
      { trackId: options.trackId },
    );
  }
  const segment = {
    id: options.id ?? `segment-${track.segments.length + 1}`,
    assetId: options.assetId ?? null,
    kind: options.kind ?? "video",
    name: options.name ?? "Segment",
    sourceStartUs: options.sourceStartUs ?? 0,
    sourceDurationUs: options.sourceDurationUs ?? 0,
    timelineStartUs: options.timelineStartUs ?? 0,
    timelineDurationUs: options.timelineDurationUs ?? 0,
    effects: [],
    keyframes: [],
    transitionIn: null,
    transitionOut: null,
    locked: false,
  };
  track.segments.push(segment);
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return segment;
}

/**
 * Split one segment at a source offset.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options split options
 * @returns {{ left: object, right: object }} the two resulting segments
 */
export function splitSegment(draft, options) {
  const track = findTrack(draft, options.trackId);
  const index = track?.segments.findIndex(
    (segment) => segment.id === options.segmentId,
  );
  if (track === undefined || index === undefined || index < 0) {
    throw new ContractError(
      "editor.segment.not-found",
      `segment not found: ${options.segmentId}`,
      { segmentId: options.segmentId },
    );
  }
  const segment = track.segments[index];
  const offsetUs = options.offsetUs ?? 0;
  if (offsetUs <= 0 || offsetUs >= segment.sourceDurationUs) {
    throw new ContractError(
      "editor.segment.invalid-split-offset",
      `split offset ${offsetUs} is outside the segment`,
      { offsetUs, sourceDurationUs: segment.sourceDurationUs },
    );
  }
  const right = {
    ...structuredClone(segment),
    id: `${segment.id}-split`,
    sourceStartUs: segment.sourceStartUs + offsetUs,
    sourceDurationUs: segment.sourceDurationUs - offsetUs,
    timelineStartUs: segment.timelineStartUs + offsetUs,
    timelineDurationUs: segment.timelineDurationUs - offsetUs,
    effects: [],
    keyframes: [],
  };
  segment.sourceDurationUs = offsetUs;
  segment.timelineDurationUs = offsetUs;
  track.segments.splice(index + 1, 0, right);
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return { left: segment, right };
}

/**
 * Remove a segment from its track.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options removal options
 * @returns {object} the removed segment
 */
export function removeSegment(draft, options) {
  const track = findTrack(draft, options.trackId);
  const index = track?.segments.findIndex(
    (segment) => segment.id === options.segmentId,
  );
  if (track === undefined || index === undefined || index < 0) {
    throw new ContractError(
      "editor.segment.not-found",
      `segment not found: ${options.segmentId}`,
      { segmentId: options.segmentId },
    );
  }
  const [removed] = track.segments.splice(index, 1);
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return removed;
}

/**
 * Move a segment to a new timeline position.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options move options
 * @returns {object} the moved segment
 */
export function moveSegment(draft, options) {
  const track = findTrack(draft, options.trackId);
  const segment = track?.segments.find(
    (candidate) => candidate.id === options.segmentId,
  );
  if (segment === undefined) {
    throw new ContractError(
      "editor.segment.not-found",
      `segment not found: ${options.segmentId}`,
      { segmentId: options.segmentId },
    );
  }
  segment.timelineStartUs = options.timelineStartUs ?? segment.timelineStartUs;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return segment;
}

/**
 * Change a segment duration.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options duration options
 * @returns {object} the updated segment
 */
export function updateSegmentDuration(draft, options) {
  const track = findTrack(draft, options.trackId);
  const segment = track?.segments.find(
    (candidate) => candidate.id === options.segmentId,
  );
  if (segment === undefined) {
    throw new ContractError(
      "editor.segment.not-found",
      `segment not found: ${options.segmentId}`,
      { segmentId: options.segmentId },
    );
  }
  segment.sourceDurationUs = options.durationUs;
  segment.timelineDurationUs = options.durationUs;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return segment;
}

/**
 * Attach a named effect to a segment.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options effect options
 * @returns {object} the updated segment
 */
export function addVideoEffect(draft, options) {
  const track = findTrack(draft, options.trackId);
  const segment = track?.segments.find(
    (candidate) => candidate.id === options.segmentId,
  );
  if (segment === undefined) {
    throw new ContractError(
      "editor.segment.not-found",
      `segment not found: ${options.segmentId}`,
      { segmentId: options.segmentId },
    );
  }
  segment.effects.push({
    id: options.effectId ?? `effect-${segment.effects.length + 1}`,
    name: options.name ?? "effect",
    params: options.params ?? {},
  });
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return segment;
}

/**
 * Add a keyframe to a segment property.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options keyframe options
 * @returns {object} the updated segment
 */
export function addCommonKeyframe(draft, options) {
  const track = findTrack(draft, options.trackId);
  const segment = track?.segments.find(
    (candidate) => candidate.id === options.segmentId,
  );
  if (segment === undefined) {
    throw new ContractError(
      "editor.segment.not-found",
      `segment not found: ${options.segmentId}`,
      { segmentId: options.segmentId },
    );
  }
  const keyframe = {
    id: options.id ?? `keyframe-${segment.keyframes.length + 1}`,
    property: options.property ?? "scale",
    timeUs: options.timeUs ?? 0,
    value: options.value ?? 1,
  };
  segment.keyframes.push(keyframe);
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return keyframe;
}

/**
 * Set a transition on a segment boundary.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options transition options
 * @returns {object} the updated segment
 */
export function addVideoTransition(draft, options) {
  const track = findTrack(draft, options.trackId);
  const segment = track?.segments.find(
    (candidate) => candidate.id === options.segmentId,
  );
  if (segment === undefined) {
    throw new ContractError(
      "editor.segment.not-found",
      `segment not found: ${options.segmentId}`,
      { segmentId: options.segmentId },
    );
  }
  const transition = {
    name: options.name ?? "dissolve",
    durationUs: options.durationUs ?? 0,
  };
  if (options.side === "out") segment.transitionOut = transition;
  else segment.transitionIn = transition;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return segment;
}

/**
 * Arrange the tracks of the main timeline in a given order.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options arrangement options
 * @returns {string[]} the resulting track order
 */
export function arrangeTimelineTracks(draft, options) {
  const order = options.order ?? [];
  const timeline = draft.timelines[draft.mainTimelineId];
  if (timeline === undefined) {
    throw new ContractError(
      "editor.timeline.not-found",
      "main timeline is not present",
      { mainTimelineId: draft.mainTimelineId },
    );
  }
  const known = new Set(draft.tracks.map((track) => track.id));
  for (const trackId of order) {
    if (!known.has(trackId)) {
      throw new ContractError(
        "editor.track.not-found",
        `track not found: ${trackId}`,
        { trackId },
      );
    }
  }
  const remaining = timeline.trackIds.filter((trackId) => !order.includes(trackId));
  timeline.trackIds = [...order, ...remaining];
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return timeline.trackIds;
}

/**
 * Move a track to a new index within its timeline.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options move options
 * @returns {string[]} the resulting track order
 */
export function moveTrack(draft, options) {
  const timeline = findTimelineOfTrack(draft, options.trackId);
  if (timeline === undefined) {
    throw new ContractError(
      "editor.timeline.not-found",
      `track has no timeline: ${options.trackId}`,
      { trackId: options.trackId },
    );
  }
  const from = timeline.trackIds.indexOf(options.trackId);
  const to = Math.max(0, Math.min(options.toIndex ?? from, timeline.trackIds.length - 1));
  timeline.trackIds.splice(from, 1);
  timeline.trackIds.splice(to, 0, options.trackId);
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return timeline.trackIds;
}

/**
 * Mute or unmute every track.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options mute options
 * @returns {object[]} the updated tracks
 */
export function muteAllTracks(draft, options) {
  const muted = options.muted ?? true;
  for (const track of draft.tracks) track.muted = muted;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return draft.tracks;
}

/**
 * Insert a draft asset into a timeline, honouring the recovered placement
 * options: append, or at a position with ripple or overwrite collision.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options insert options
 * @returns {Record<string, unknown>} the insertion result
 */
export function insertDraftIntoTimeline(draft, options) {
  const asset = findAsset(draft, options.assetId);
  if (asset === undefined) {
    throw new ContractError(
      "timeline_cli_missing_asset",
      `asset not found: ${options.assetId}`,
      { assetId: options.assetId },
    );
  }
  assertRevision(
    "timeline_cli_revision_conflict",
    options.expectedAssetRevision,
    asset.revision,
  );
  const timeline = draft.timelines[draft.mainTimelineId];
  if (timeline === undefined) {
    throw new ContractError(
      "timeline_cli_project_mismatch",
      "main timeline is not present",
      { mainTimelineId: draft.mainTimelineId },
    );
  }
  assertRevision(
    "timeline_cli_revision_conflict",
    options.expectedTimelineRevision,
    timeline.revision,
  );
  const before = structuredClone(draft);
  const representation = options.representation ?? "expanded";
  const targetTrack = draft.tracks.find((track) => track.type === "video");
  if (targetTrack === undefined) {
    throw new ContractError(
      "timeline_cli_busy",
      "no video track is available",
      {},
    );
  }
  const durationUs = asset.durationUs ?? 0;
  const segment = {
    id: `segment-${targetTrack.segments.length + 1}`,
    assetId: asset.assetId,
    kind: "video",
    name: asset.name,
    sourceStartUs: 0,
    sourceDurationUs: durationUs,
    timelineStartUs: 0,
    timelineDurationUs: durationUs,
    effects: [],
    keyframes: [],
    transitionIn: null,
    transitionOut: null,
    locked: false,
    representation,
  };
  const placement = options.placement ?? "append";
  if (placement === "append") {
    const endUs = targetTrack.segments.reduce(
      (maximum, candidate) =>
        Math.max(maximum, candidate.timelineStartUs + candidate.timelineDurationUs),
      0,
    );
    segment.timelineStartUs = endUs;
  } else {
    const positionUs = options.positionUs ?? 0;
    segment.timelineStartUs = positionUs;
    const collision = options.collision ?? "ripple";
    if (collision === "overwrite") {
      targetTrack.segments = targetTrack.segments.filter(
        (candidate) =>
          candidate.timelineStartUs + candidate.timelineDurationUs <= positionUs ||
          candidate.timelineStartUs >= positionUs + durationUs,
      );
    } else {
      for (const candidate of targetTrack.segments) {
        const candidateEnd =
          candidate.timelineStartUs + candidate.timelineDurationUs;
        if (
          candidate.timelineStartUs < positionUs + durationUs &&
          candidateEnd > positionUs
        ) {
          candidate.timelineStartUs += durationUs;
        }
      }
    }
  }
  if (options.dryRun === true) {
    return {
      dryRun: true,
      timelineRevision: timeline.revision,
      addedSegmentIds: [],
      removedSegmentIds: [],
      preview: {
        trackId: targetTrack.id,
        timelineStartUs: segment.timelineStartUs,
        timelineDurationUs: segment.timelineDurationUs,
      },
    };
  }
  pushHistory(draft, "timeline.add-draft", before);
  targetTrack.segments.push(segment);
  timeline.revision += 1;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return {
    dryRun: false,
    timelineRevision: timeline.revision,
    addedSegmentIds: [segment.id],
    removedSegmentIds: [],
  };
}
