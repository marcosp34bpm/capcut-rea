/**
 * Contract tests for the reconstructed editor.
 *
 * Each test asserts one behavior that the shipped CapCut 9.6 application
 * documents or that the recovered native surface implies.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attachAsset,
  createNode,
  deleteNode,
  duplicateNode,
  transformNode,
  undo,
  updateNode,
} from "../src/model/canvas.mjs";
import {
  addTrack,
  addVideo,
  addVideoEffect,
  arrangeTimelineTracks,
  insertDraftIntoTimeline,
  moveTrack,
  splitSegment,
} from "../src/model/timeline.mjs";
import { ContractError, createDraft } from "../src/model/draft.mjs";

const seed = () => {
  const draft = createDraft({ name: "test" });
  draft.timelines[draft.mainTimelineId] = {
    id: draft.mainTimelineId,
    revision: 1,
    trackIds: [],
  };
  draft.assets = [
    {
      assetId: "asset-1",
      kind: "draft",
      name: "Draft 1",
      revision: 1,
      status: "ready",
      localPath: null,
      durationUs: 4_000_000,
    },
  ];
  return draft;
};

test("a draft starts with one main timeline and no tracks", () => {
  const draft = seed();
  assert.equal(draft.tracks.length, 0);
  assert.equal(draft.timelines[draft.mainTimelineId].trackIds.length, 0);
  assert.equal(draft.revision, 1);
});

test("addTrack registers the track in the main timeline", () => {
  const draft = seed();
  const track = addTrack(draft, { type: "video", name: "Vídeo 1" });
  assert.deepEqual(draft.timelines[draft.mainTimelineId].trackIds, [track.id]);
});

test("addTrack rejects an unsupported track type", () => {
  const draft = seed();
  assert.throws(
    () => addTrack(draft, { type: "hologram" }),
    (cause) => cause instanceof ContractError && cause.code === "editor.track.invalid-type",
  );
});

test("splitSegment divides a segment at the requested source offset", () => {
  const draft = seed();
  const track = addTrack(draft, { type: "video" });
  const segment = addVideo(draft, {
    trackId: track.id,
    sourceDurationUs: 10_000_000,
    timelineDurationUs: 10_000_000,
  });
  const { left, right } = splitSegment(draft, {
    trackId: track.id,
    segmentId: segment.id,
    offsetUs: 4_000_000,
  });
  assert.equal(left.sourceDurationUs, 4_000_000);
  assert.equal(right.sourceDurationUs, 6_000_000);
  assert.equal(right.sourceStartUs, 4_000_000);
  assert.equal(track.segments.length, 2);
});

test("splitSegment rejects an offset outside the segment", () => {
  const draft = seed();
  const track = addTrack(draft, { type: "video" });
  const segment = addVideo(draft, { trackId: track.id, sourceDurationUs: 1_000_000 });
  assert.throws(
    () =>
      splitSegment(draft, {
        trackId: track.id,
        segmentId: segment.id,
        offsetUs: 5_000_000,
      }),
    (cause) => cause.code === "editor.segment.invalid-split-offset",
  );
});

test("a stale expected revision is rejected as a conflict", () => {
  const draft = seed();
  const node = createNode(draft, { type: "text" });
  assert.throws(
    () =>
      updateNode(draft, {
        objectId: node.objectId,
        expectedRevision: 99,
        label: "novo",
      }),
    (cause) => cause.code === "canvas_cli_revision_conflict",
  );
});

test("updateNode increments the node revision and the canvas revision", () => {
  const draft = seed();
  const node = createNode(draft, { type: "text" });
  const before = draft.canvasRevision;
  const result = updateNode(draft, {
    objectId: node.objectId,
    expectedRevision: node.revision,
    label: "Título",
  });
  assert.equal(result.revision, 2);
  assert.equal(draft.canvasRevision, before + 1);
  assert.equal(draft.canvas.nodes[0].label, "Título");
});

test("a dry run reports the outcome without mutating the draft", () => {
  const draft = seed();
  const node = createNode(draft, { type: "text" });
  const result = updateNode(draft, {
    objectId: node.objectId,
    expectedRevision: node.revision,
    label: "não aplicado",
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  assert.equal(draft.canvas.nodes[0].label, "Node 1");
  assert.equal(draft.canvas.nodes[0].revision, 1);
});

test("deleteNode removes the node and reports the deletion", () => {
  const draft = seed();
  const node = createNode(draft, { type: "media" });
  const result = deleteNode(draft, {
    objectId: node.objectId,
    expectedRevision: node.revision,
  });
  assert.equal(result.dryRun, false);
  assert.equal(draft.canvas.nodes.length, 0);
});

test("duplicateNode records the source node id on the copy", () => {
  const draft = seed();
  const node = createNode(draft, { type: "text" });
  const result = duplicateNode(draft, {
    objectId: node.objectId,
    expectedCanvasRevision: draft.canvasRevision,
  });
  assert.equal(result.sourceNodeId, node.objectId);
  assert.equal(draft.canvas.nodes.length, 2);
  assert.equal(draft.canvas.nodes[1].sourceNodeId, node.objectId);
});

test("transformNode applies the layout delta", () => {
  const draft = seed();
  const node = createNode(draft, { type: "text" });
  const result = transformNode(draft, {
    objectId: node.objectId,
    expectedRevision: node.revision,
    delta: { x: 40, y: 80 },
  });
  assert.equal(result.layout.x, 40);
  assert.equal(result.layout.y, 80);
});

test("attachAsset rejects an unknown asset with a missing asset id", () => {
  const draft = seed();
  const node = createNode(draft, { type: "media" });
  assert.throws(
    () =>
      attachAsset(draft, {
        objectId: node.objectId,
        assetId: "asset-missing",
        expectedRevision: node.revision,
      }),
    (cause) =>
      cause.code === "canvas_cli_missing_asset_id" &&
      cause.details.missingAssetIds[0] === "asset-missing",
  );
});

test("undo restores the state captured before the last mutation", () => {
  const draft = seed();
  const node = createNode(draft, { type: "text" });
  updateNode(draft, {
    objectId: node.objectId,
    expectedRevision: node.revision,
    label: "Alterado",
  });
  assert.equal(draft.canvas.nodes[0].label, "Alterado");
  assert.equal(undo(draft), true);
  assert.equal(draft.canvas.nodes[0].label, "Node 1");
});

test("arrangeTimelineTracks keeps unknown track ids out of the order", () => {
  const draft = seed();
  const first = addTrack(draft, { type: "video" });
  const second = addTrack(draft, { type: "audio" });
  const order = arrangeTimelineTracks(draft, { order: [second.id, first.id] });
  assert.deepEqual(order, [second.id, first.id]);
  assert.throws(
    () => arrangeTimelineTracks(draft, { order: ["track-99"] }),
    (cause) => cause.code === "editor.track.not-found",
  );
});

test("moveTrack reorders within the owning timeline", () => {
  const draft = seed();
  const first = addTrack(draft, { type: "video" });
  const second = addTrack(draft, { type: "audio" });
  const order = moveTrack(draft, { trackId: second.id, toIndex: 0 });
  assert.deepEqual(order, [second.id, first.id]);
});

test("insertDraftIntoTimeline appends a segment and bumps the timeline revision", () => {
  const draft = seed();
  const track = addTrack(draft, { type: "video" });
  const result = insertDraftIntoTimeline(draft, {
    assetId: "asset-1",
    expectedAssetRevision: 1,
  });
  assert.equal(result.dryRun, false);
  assert.equal(result.addedSegmentIds.length, 1);
  assert.equal(result.timelineRevision, 2);
  assert.equal(track.segments.length, 1);
  assert.equal(track.segments[0].timelineStartUs, 0);
});

test("insertDraftIntoTimeline honors a dry run", () => {
  const draft = seed();
  addTrack(draft, { type: "video" });
  const result = insertDraftIntoTimeline(draft, {
    assetId: "asset-1",
    expectedAssetRevision: 1,
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.addedSegmentIds.length, 0);
  assert.equal(draft.tracks[0].segments.length, 0);
});

test("insertDraftIntoTimeline rejects a stale asset revision", () => {
  const draft = seed();
  addTrack(draft, { type: "video" });
  assert.throws(
    () =>
      insertDraftIntoTimeline(draft, {
        assetId: "asset-1",
        expectedAssetRevision: 42,
      }),
    (cause) => cause.code === "timeline_cli_revision_conflict",
  );
});

test("insertDraftIntoTimeline rejects an unknown asset", () => {
  const draft = seed();
  addTrack(draft, { type: "video" });
  assert.throws(
    () => insertDraftIntoTimeline(draft, { assetId: "asset-nope" }),
    (cause) => cause.code === "timeline_cli_missing_asset",
  );
});

test("ripple collision shifts an overlapping segment", () => {
  const draft = seed();
  const track = addTrack(draft, { type: "video" });
  addVideo(draft, {
    trackId: track.id,
    sourceDurationUs: 2_000_000,
    timelineDurationUs: 2_000_000,
    timelineStartUs: 0,
  });
  insertDraftIntoTimeline(draft, {
    assetId: "asset-1",
    expectedAssetRevision: 1,
    placement: "at",
    positionUs: 1_000_000,
    collision: "ripple",
  });
  assert.equal(track.segments[0].timelineStartUs, 4_000_000);
});

test("overwrite collision removes an overlapping segment", () => {
  const draft = seed();
  const track = addTrack(draft, { type: "video" });
  addVideo(draft, {
    trackId: track.id,
    sourceDurationUs: 2_000_000,
    timelineDurationUs: 2_000_000,
    timelineStartUs: 0,
  });
  insertDraftIntoTimeline(draft, {
    assetId: "asset-1",
    expectedAssetRevision: 1,
    placement: "at",
    positionUs: 1_000_000,
    collision: "overwrite",
  });
  assert.equal(track.segments.length, 1);
});

test("addVideoEffect attaches the effect to the segment", () => {
  const draft = seed();
  const track = addTrack(draft, { type: "video" });
  const segment = addVideo(draft, { trackId: track.id });
  const updated = addVideoEffect(draft, {
    trackId: track.id,
    segmentId: segment.id,
    name: "blur",
    params: { radius: 4 },
  });
  assert.equal(updated.effects[0].name, "blur");
});
