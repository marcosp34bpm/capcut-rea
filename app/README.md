# CapCut reconstruction — editor agent

A reconstruction of the **CapCut 9.6 editor agent contract**, built from the
static analysis in [`../README.md`](../README.md) and
[`../native/videoeditor-addon-methods.md`](../native/videoeditor-addon-methods.md).

This is **not** CapCut and does not contain CapCut code. It is a
reimplementation of the *observable contract* that the shipped application
exposes to an AI agent: a revision-checked timeline and canvas model, a
`lyra-cli-ipc` bridge with the recovered command surface and error codes, and a
local web UI.

## What was recovered and reproduced

| Recovered behavior | Where it comes from | Reimplemented in |
| --- | --- | --- |
| `agent-hub.canvas-capabilities.v1` schema with `commands`, `node_types`, `asset_kinds`, `concurrency` | `canvas-node-cli/SKILL.md` | `src/lyra-cli-ipc.mjs` |
| Optimistic concurrency: `revision` on nodes, `canvas_revision` on the canvas, `timeline_revision` on timelines | `canvas-node-cli`, `timeline-draft-cli` skills | `src/model/draft.mjs` |
| `--dry-run` on every mutation, returning `dry_run: true` and no state change | both skills | every mutating function |
| `expected_revision` / `expected_canvas_revision` / `expected_asset_revision` guards | both skills | `assertRevision` in `src/model/draft.mjs` |
| Error codes `canvas_cli_revision_conflict`, `canvas_cli_canvas_revision_conflict`, `canvas_cli_asset_revision_conflict`, `canvas_cli_missing_object_id`, `canvas_cli_missing_asset_id` | `canvas-node-cli/SKILL.md` | `src/model/canvas.mjs` |
| Error codes `timeline_cli_revision_conflict`, `timeline_cli_project_mismatch`, `timeline_cli_busy`, `timeline_cli_missing_asset` | `timeline-draft-cli/SKILL.md` | `src/model/timeline.mjs` |
| `add-draft` placement `append` / `at --position-us`, collision `ripple` / `overwrite`, representation `nested` / `expanded` | `timeline-draft-cli/SKILL.md` | `insertDraftIntoTimeline` |
| `added_segment_ids`, `removed_segment_ids`, `timeline_revision` result fields | `timeline-draft-cli/SKILL.md` | `insertDraftIntoTimeline` |
| `object_id`, `revision`, `parent_frame_id`, `layout` node fields | `canvas-node-cli/SKILL.md` | `src/model/canvas.mjs` |
| `asset_id`, `revision`, `status`, `local_path_status` | both skills | `src/lyra-cli-ipc.mjs` |
| Native method vocabulary (`addVideo`, `splitSegment`, `moveSegment`, `addVideoEffect`, `addCommonKeyframe`, `addVideoTransition`, `arrangeTimelineTracks`, `moveTrack`, `muteAllTracks`, …) | `videoeditor_addon.node` string inventory | `src/model/timeline.mjs`, `src/model/canvas.mjs` |

## Layout

```
app/
├── package.json
├── src/
│   ├── model/
│   │   ├── draft.mjs        draft document, revisions, error algebra
│   │   ├── timeline.mjs     tracks, segments, effects, keyframes, placement
│   │   └── canvas.mjs       canvas nodes, transforms, undo
│   ├── lyra-cli-ipc.mjs     command surface and JSON shapes
│   ├── cli.mjs              CLI entry point
│   ├── server.mjs           local HTTP API
│   ├── session.mjs          JSON-backed session store
│   ├── index.html           web UI
│   └── app.js               web UI logic
└── test/
    ├── editor.test.mjs      22 contract tests
    └── lyra-cli-ipc.test.mjs 13 contract tests
```

## Run

```sh
cd app
npm test                 # 35 tests
npm start                # http://localhost:8787
```

## Use the CLI

```sh
node src/cli.mjs canvas capabilities --output json
node src/cli.mjs canvas asset list --kind draft --output json
node src/cli.mjs canvas asset get --id asset-1 --output json

node src/cli.mjs timeline add-track --type video --name "Video 1" --output json
node src/cli.mjs timeline add-draft --asset-id asset-1 \
    --expected-asset-revision 1 --dry-run --output json
node src/cli.mjs timeline add-draft --asset-id asset-1 \
    --expected-asset-revision 1 --output json
```

The CLI also accepts one JSON request on stdin, matching the shipped launcher:

```sh
echo '{"commandId":"op-1","action":"timeline.add-draft","args":{"assetId":"asset-1","expectedAssetRevision":1}}' \
  | node src/cli.mjs --stdin
```

## Use the HTTP API

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/state` | — |
| `POST` | `/api/timeline.add-track` | `{"args":{"type":"video"}}` |
| `POST` | `/api/timeline.add-draft` | `{"args":{"assetId":"asset-1","expectedAssetRevision":1}}` |
| `POST` | `/api/timeline.split-segment` | `{"args":{"trackId":"track-1","segmentId":"segment-1","offsetUs":1000000}}` |
| `POST` | `/api/canvas.create-node` | `{"args":{"type":"text","label":"Title"}}` |
| `POST` | `/api/canvas.duplicate-node` | `{"args":{"objectId":"node-1","expectedCanvasRevision":2}}` |
| `POST` | `/api/editor.undo` | `{}` |

Every operation accepts `dryRun: true` in `args` and returns the outcome
without mutating the session.

## What this reconstruction does not do

- It does not decode or play video. The native `videoeditor_addon.node`
  surface was observed as strings; no media pipeline was reconstructed.
- It does not reproduce the shipped rendering, effect or AI behavior. The
  ledger's 1,789 obligations remain open precisely because none of that
  behavior has been verified.
- It does not reproduce CapCut's proprietary protocol, cloud sync, or account
  system.
- The reconstructed method names come from static string observations. They
  match the shipped vocabulary, but the shipped parameter types and return
  values were not recovered.

## Evidence

Every claim above traces to a specific Evidence ID in the parent
[`../README.md`](../README.md). The reconstruction obligation ledger for each
analyzed application tree is in [`../ledger/`](../ledger/).
