/**
 * Contract tests for the reconstructed `lyra-cli-ipc` bridge.
 *
 * The command surface, the JSON field names and the error codes are the ones
 * documented by the packaged `canvas-node-cli` and `timeline-draft-cli` skills
 * of the shipped CapCut 9.6 application.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ContractError, createDraft } from "../src/model/draft.mjs";
import { dispatch, parseArgs } from "../src/lyra-cli-ipc.mjs";

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

test("parseArgs reads flags and values", () => {
  const parsed = parseArgs([
    "timeline",
    "add-draft",
    "--asset-id",
    "asset-1",
    "--dry-run",
  ]);
  assert.equal(parsed["asset-id"], "asset-1");
  assert.equal(parsed["dry-run"], true);
});

test("canvas capabilities advertises the recovered schema", () => {
  const draft = seed();
  const capabilities = dispatch(draft, ["canvas", "capabilities"]);
  assert.equal(capabilities.schema, "agent-hub.canvas-capabilities.v1");
  assert.equal(capabilities.concurrency.mode, "optimistic");
  assert.equal(capabilities.concurrency.dry_run_supported, true);
  assert.ok(capabilities.commands.includes("timeline add-draft"));
});

test("canvas asset list filters by kind", () => {
  const draft = seed();
  const result = dispatch(draft, ["canvas", "asset", "list", "--kind", "draft"]);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].asset_id, "asset-1");
});

test("canvas asset get reports local path status", () => {
  const draft = seed();
  const result = dispatch(draft, ["canvas", "asset", "get", "--id", "asset-1"]);
  assert.equal(result.local_path_status, "unavailable");
});

test("canvas asset get fails for an unknown asset", () => {
  const draft = seed();
  assert.throws(
    () => dispatch(draft, ["canvas", "asset", "get", "--id", "asset-x"]),
    (cause) =>
      cause instanceof ContractError && cause.code === "canvas_cli_missing_asset_id",
  );
});

test("canvas node create returns the new node id and revision", () => {
  const draft = seed();
  const result = dispatch(draft, [
    "canvas",
    "node",
    "create",
    "--type",
    "text",
    "--label",
    "Título",
  ]);
  assert.equal(result.results[0].node_id, "node-1");
  assert.equal(result.results[0].revision, 1);
  assert.equal(draft.canvas.nodes[0].label, "Título");
});

test("canvas node update rejects a stale expected revision", () => {
  const draft = seed();
  dispatch(draft, ["canvas", "node", "create"]);
  assert.throws(
    () =>
      dispatch(draft, [
        "canvas",
        "node",
        "update",
        "--id",
        "node-1",
        "--expected-revision",
        "99",
        "--label",
        "x",
      ]),
    (cause) => cause.code === "canvas_cli_revision_conflict",
  );
});

test("canvas node update applies the label when the revision matches", () => {
  const draft = seed();
  dispatch(draft, ["canvas", "node", "create"]);
  const result = dispatch(draft, [
    "canvas",
    "node",
    "update",
    "--id",
    "node-1",
    "--expected-revision",
    "1",
    "--label",
    "Novo",
  ]);
  assert.equal(result.results[0].revision, 2);
  assert.equal(draft.canvas.nodes[0].label, "Novo");
});

test("canvas node duplicate reports the source node id", () => {
  const draft = seed();
  dispatch(draft, ["canvas", "node", "create"]);
  const result = dispatch(draft, [
    "canvas",
    "node",
    "duplicate",
    "--id",
    "node-1",
    "--expected-canvas-revision",
    String(draft.canvasRevision),
  ]);
  assert.equal(result.results[0].source_node_id, "node-1");
});

test("timeline add-draft inserts a segment and reports the timeline revision", () => {
  const draft = seed();
  dispatch(draft, ["timeline", "add-track", "--type", "video"]);
  const result = dispatch(draft, [
    "timeline",
    "add-draft",
    "--asset-id",
    "asset-1",
    "--expected-asset-revision",
    "1",
  ]);
  assert.equal(result.addedSegmentIds.length, 1);
  assert.equal(result.timelineRevision, 2);
});

test("timeline add-draft honors the dry-run flag", () => {
  const draft = seed();
  dispatch(draft, ["timeline", "add-track", "--type", "video"]);
  const result = dispatch(draft, [
    "timeline",
    "add-draft",
    "--asset-id",
    "asset-1",
    "--expected-asset-revision",
    "1",
    "--dry-run",
  ]);
  assert.equal(result.dryRun, true);
  assert.equal(draft.tracks[0].segments.length, 0);
});

test("timeline add-draft rejects a stale asset revision", () => {
  const draft = seed();
  dispatch(draft, ["timeline", "add-track", "--type", "video"]);
  assert.throws(
    () =>
      dispatch(draft, [
        "timeline",
        "add-draft",
        "--asset-id",
        "asset-1",
        "--expected-asset-revision",
        "42",
      ]),
    (cause) => cause.code === "timeline_cli_revision_conflict",
  );
});

test("an unknown command is rejected", () => {
  const draft = seed();
  assert.throws(
    () => dispatch(draft, ["nope", "nope"]),
    (cause) => cause.code === "cli_unknown_command",
  );
});
