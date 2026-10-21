/**
 * Draft document model for the reconstructed CapCut editor.
 *
 * The model mirrors the shape recovered from the shipped CapCut 9.6 artifact:
 * a draft owns tracks, each track owns segments, and every mutating operation
 * carries an optimistic revision. The revision discipline is documented in the
 * packaged `canvas-node-cli` and `timeline-draft-cli` skills of the shipped
 * application.
 */

import { randomUUID } from "node:crypto";

/** Raised for a contract violation that the caller must handle explicitly. */
export class ContractError extends Error {
  /**
   * @param {string} code stable machine-readable error code
   * @param {string} message human-readable detail
   * @param {Record<string, unknown>} [details] extra machine-readable context
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ContractError";
    this.code = code;
    this.details = details;
  }
}

export const TRACK_TYPES = ["video", "audio", "text", "sticker", "effect"];

export const ASSET_KINDS = ["draft", "video", "audio", "image", "font", "effect"];

export const NODE_TYPES = ["frame", "media", "text", "sticker", "group"];

/**
 * Create one empty draft.
 *
 * @param {Record<string, unknown>} [options] draft options
 * @returns {object} a new draft document
 */
export function createDraft(options = {}) {
  const now = Date.now();
  const mainTimelineId = randomUUID();
  return {
    id: options.id ?? randomUUID(),
    name: options.name ?? "Untitled project",
    projectId: options.projectId ?? randomUUID(),
    revision: 1,
    canvasRevision: 1,
    canvas: {
      size: { width: 1080, height: 1920 },
      nodes: [],
    },
    tracks: [],
    assets: [],
    mainTimelineId,
    timelines: {
      [mainTimelineId]: {
        id: mainTimelineId,
        revision: 1,
        trackIds: [],
      },
    },
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Return a deep structural copy of a draft.
 *
 * @param {object} draft source draft
 * @returns {object} an independent copy
 */
export function cloneDraft(draft) {
  return structuredClone(draft);
}

/**
 * Resolve one asset by id.
 *
 * @param {object} draft source draft
 * @param {string} assetId asset identifier
 * @returns {object | undefined} the asset when present
 */
export function findAsset(draft, assetId) {
  return draft.assets.find((asset) => asset.assetId === assetId);
}

/**
 * Resolve one canvas node by id.
 *
 * @param {object} draft source draft
 * @param {string} nodeId node identifier
 * @returns {object | undefined} the node when present
 */
export function findNode(draft, nodeId) {
  return draft.canvas.nodes.find((node) => node.objectId === nodeId);
}

/**
 * Resolve one track by id.
 *
 * @param {object} draft source draft
 * @param {string} trackId track identifier
 * @returns {object | undefined} the track when present
 */
export function findTrack(draft, trackId) {
  return draft.tracks.find((track) => track.id === trackId);
}

/**
 * Resolve the timeline a track belongs to.
 *
 * @param {object} draft source draft
 * @param {string} trackId track identifier
 * @returns {object | undefined} the owning timeline when present
 */
export function findTimelineOfTrack(draft, trackId) {
  for (const timeline of Object.values(draft.timelines)) {
    if (timeline.trackIds.includes(trackId)) return timeline;
  }
  return undefined;
}

/**
 * Reject a mutation whose expected revision does not match the current one.
 *
 * @param {string} code error code to raise
 * @param {number | null} expected caller supplied revision
 * @param {number} actual current revision
 * @returns {void}
 */
export function assertRevision(code, expected, actual) {
  if (expected === null || expected === undefined) return;
  if (expected !== actual) {
    throw new ContractError(
      code,
      `revision conflict: expected ${expected}, current ${actual}`,
      { expectedRevision: expected, actualRevision: actual },
    );
  }
}

/**
 * Append an undo entry recording the state before a mutation.
 *
 * @param {object} draft source draft, mutated in place
 * @param {string} label operation label
 * @param {object} before draft state before the mutation
 * @returns {void}
 */
export function pushHistory(draft, label, before) {
  draft.history.push({ label, at: Date.now(), snapshot: before });
  if (draft.history.length > 100) draft.history.shift();
}
