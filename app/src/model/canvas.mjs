/**
 * Canvas node model for the reconstructed CapCut editor.
 *
 * The contract follows the packaged `canvas-node-cli` skill of the shipped
 * CapCut 9.6 application: nodes carry an object id and a revision, mutations
 * carry `--expected-revision` or `--expected-canvas-revision`, and every
 * mutation supports a dry run.
 */

import {
  ContractError,
  assertRevision,
  findAsset,
  findNode,
  pushHistory,
} from "./draft.mjs";

/**
 * Create one canvas node.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options node options
 * @returns {object} the created node
 */
export function createNode(draft, options) {
  const type = options.type ?? "frame";
  if (!["frame", "media", "text", "sticker", "group"].includes(type)) {
    throw new ContractError(
      "canvas_cli_invalid_node_type",
      `unsupported node type: ${type}`,
      { type },
    );
  }
  const node = {
    objectId: options.objectId ?? `node-${draft.canvas.nodes.length + 1}`,
    type,
    label: options.label ?? `Node ${draft.canvas.nodes.length + 1}`,
    revision: 1,
    parentFrameId: options.parentFrameId ?? null,
    layout: options.layout ?? {
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      rotation: 0,
      scale: 1,
    },
    assetId: options.assetId ?? null,
    content: options.content ?? null,
  };
  draft.canvas.nodes.push(node);
  draft.canvasRevision += 1;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return node;
}

/**
 * Update the mutable properties of a node.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options update options
 * @returns {object} the updated node
 */
export function updateNode(draft, options) {
  const node = findNode(draft, options.objectId);
  if (node === undefined) {
    throw new ContractError(
      "canvas_cli_missing_object_id",
      `node not found: ${options.objectId}`,
      { missingObjectIds: [options.objectId] },
    );
  }
  assertRevision(
    "canvas_cli_revision_conflict",
    options.expectedRevision,
    node.revision,
  );
  if (options.dryRun === true) {
    return { dryRun: true, nodeId: node.objectId, revision: node.revision };
  }
  const before = structuredClone(draft);
  if (options.label !== undefined) node.label = options.label;
  if (options.layout !== undefined) node.layout = { ...node.layout, ...options.layout };
  if (options.content !== undefined) node.content = options.content;
  pushHistory(draft, "canvas.node.update", before);
  node.revision += 1;
  draft.canvasRevision += 1;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return { dryRun: false, nodeId: node.objectId, revision: node.revision };
}

/**
 * Transform a node by a layout delta.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options transform options
 * @returns {object} the updated node
 */
export function transformNode(draft, options) {
  const node = findNode(draft, options.objectId);
  if (node === undefined) {
    throw new ContractError(
      "canvas_cli_missing_object_id",
      `node not found: ${options.objectId}`,
      { missingObjectIds: [options.objectId] },
    );
  }
  assertRevision(
    "canvas_cli_revision_conflict",
    options.expectedRevision,
    node.revision,
  );
  const delta = options.delta ?? {};
  const layout = { ...node.layout };
  if (delta.x !== undefined) layout.x += delta.x;
  if (delta.y !== undefined) layout.y += delta.y;
  if (delta.width !== undefined) layout.width = delta.width;
  if (delta.height !== undefined) layout.height = delta.height;
  if (delta.rotation !== undefined) layout.rotation = delta.rotation;
  if (delta.scale !== undefined) layout.scale = delta.scale;
  if (options.dryRun === true) {
    return { dryRun: true, nodeId: node.objectId, revision: node.revision, layout };
  }
  const before = structuredClone(draft);
  pushHistory(draft, "canvas.node.transform", before);
  node.layout = layout;
  node.revision += 1;
  draft.canvasRevision += 1;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return { dryRun: false, nodeId: node.objectId, revision: node.revision, layout };
}

/**
 * Move a node to a new parent frame.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options move options
 * @returns {object} the updated node
 */
export function moveNode(draft, options) {
  const node = findNode(draft, options.objectId);
  if (node === undefined) {
    throw new ContractError(
      "canvas_cli_missing_object_id",
      `node not found: ${options.objectId}`,
      { missingObjectIds: [options.objectId] },
    );
  }
  assertRevision(
    "canvas_cli_canvas_revision_conflict",
    options.expectedCanvasRevision,
    draft.canvasRevision,
  );
  if (options.parentFrameId !== null && options.parentFrameId !== undefined) {
    const parent = findNode(draft, options.parentFrameId);
    if (parent === undefined) {
      throw new ContractError(
        "canvas_cli_missing_object_id",
        `parent frame not found: ${options.parentFrameId}`,
        { missingObjectIds: [options.parentFrameId] },
      );
    }
  }
  if (options.dryRun === true) {
    return { dryRun: true, nodeId: node.objectId, revision: node.revision };
  }
  const before = structuredClone(draft);
  pushHistory(draft, "canvas.node.move", before);
  node.parentFrameId = options.parentFrameId ?? null;
  node.revision += 1;
  draft.canvasRevision += 1;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return { dryRun: false, nodeId: node.objectId, revision: node.revision };
}

/**
 * Duplicate a node, recording the source node id on the copy.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options duplicate options
 * @returns {object} the created node
 */
export function duplicateNode(draft, options) {
  const node = findNode(draft, options.objectId);
  if (node === undefined) {
    throw new ContractError(
      "canvas_cli_missing_object_id",
      `node not found: ${options.objectId}`,
      { missingObjectIds: [options.objectId] },
    );
  }
  assertRevision(
    "canvas_cli_canvas_revision_conflict",
    options.expectedCanvasRevision,
    draft.canvasRevision,
  );
  const copy = {
    ...structuredClone(node),
    objectId: `node-${draft.canvas.nodes.length + 1}`,
    sourceNodeId: node.objectId,
    revision: 1,
  };
  if (options.dryRun === true) {
    return { dryRun: true, nodeId: copy.objectId, sourceNodeId: node.objectId };
  }
  const before = structuredClone(draft);
  pushHistory(draft, "canvas.node.duplicate", before);
  draft.canvas.nodes.push(copy);
  draft.canvasRevision += 1;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return { dryRun: false, nodeId: copy.objectId, sourceNodeId: node.objectId };
}

/**
 * Delete a node.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options delete options
 * @returns {object} the deletion result
 */
export function deleteNode(draft, options) {
  const node = findNode(draft, options.objectId);
  if (node === undefined) {
    throw new ContractError(
      "canvas_cli_missing_object_id",
      `node not found: ${options.objectId}`,
      { missingObjectIds: [options.objectId] },
    );
  }
  assertRevision(
    "canvas_cli_revision_conflict",
    options.expectedRevision,
    node.revision,
  );
  if (options.dryRun === true) {
    return { dryRun: true, nodeId: node.objectId };
  }
  const before = structuredClone(draft);
  pushHistory(draft, "canvas.node.delete", before);
  draft.canvas.nodes = draft.canvas.nodes.filter(
    (candidate) => candidate.objectId !== node.objectId,
  );
  draft.canvasRevision += 1;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return { dryRun: false, nodeId: node.objectId };
}

/**
 * Attach an asset reference to a node.
 *
 * @param {object} draft source draft
 * @param {Record<string, unknown>} options attach options
 * @returns {object} the updated node
 */
export function attachAsset(draft, options) {
  const node = findNode(draft, options.objectId);
  if (node === undefined) {
    throw new ContractError(
      "canvas_cli_missing_object_id",
      `node not found: ${options.objectId}`,
      { missingObjectIds: [options.objectId] },
    );
  }
  assertRevision(
    "canvas_cli_asset_revision_conflict",
    options.expectedRevision,
    node.revision,
  );
  const asset = findAsset(draft, options.assetId);
  if (asset === undefined) {
    throw new ContractError(
      "canvas_cli_missing_asset_id",
      `asset not found: ${options.assetId}`,
      { missingAssetIds: [options.assetId] },
    );
  }
  if (options.dryRun === true) {
    return { dryRun: true, nodeId: node.objectId, revision: node.revision };
  }
  const before = structuredClone(draft);
  pushHistory(draft, "canvas.node.attach-asset", before);
  node.assetId = asset.assetId;
  node.revision += 1;
  draft.canvasRevision += 1;
  draft.revision += 1;
  draft.updatedAt = Date.now();
  return { dryRun: false, nodeId: node.objectId, revision: node.revision };
}

/**
 * Undo the most recent recorded mutation.
 *
 * @param {object} draft source draft
 * @returns {boolean} whether an entry was restored
 */
export function undo(draft) {
  const entry = draft.history.pop();
  if (entry === undefined) return false;
  const restored = entry.snapshot;
  draft.tracks = restored.tracks;
  draft.canvas = restored.canvas;
  draft.assets = restored.assets;
  draft.timelines = restored.timelines;
  draft.mainTimelineId = restored.mainTimelineId;
  draft.canvasRevision = restored.canvasRevision;
  draft.revision = restored.revision;
  draft.updatedAt = Date.now();
  return true;
}
