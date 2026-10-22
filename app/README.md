# CapCut reconstruction — editor agent

Two editions of the same recovered contract:

1. **Native edition** — drives the **real** shipped CapCut engine through the
   `videoeditor_addon.node` Node-API addon. Real media decoding, real timeline
   mutation, real playback state.
2. **Model edition** — a pure-JavaScript reimplementation of the same agent
   contract, for use without CapCut installed.

Both are built from the static analysis in [`../README.md`](../README.md) and
[`../native/videoeditor-addon-methods.md`](../native/videoeditor-addon-methods.md).

---

## MCP server — the native engine as an agent tool

The native engine is exposed over MCP so an agent can drive the real editor
directly.

### Registration

Added to `~/.config/opencode/opencode.jsonc`:

```jsonc
"capcut": {
  "type": "local",
  "command": [
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Users\\marco\\Documents\\capcut-rea\\app\\src\\mcp-native.mjs"
  ],
  "enabled": true,
  "environment": {
    "CAPCUT_ROOT": "C:\\Users\\marco\\AppData\\Local\\CapCut\\Apps\\9.6.0.4097",
    "CAPCUT_DRAFT_PATH": "C:\\Users\\marco\\Documents\\capcut-rea\\app\\native\\draft_content.json"
  }
}
```

### Tool surface

The native `edit` domain accepts 199 operations. Registering one MCP tool per
operation would flood the agent's context, so the surface stays at five tools:

| Tool | Purpose |
| --- | --- |
| `capcut_capabilities` | Engine identity, the operation catalogue by group, and the confirmed parameter shapes. Start here. |
| `capcut_state` | Live native playback state and a draft summary. |
| `capcut_draft` | The canonical native draft, optionally one section or a summary. |
| `capcut_edit` | Run one native edit operation; returns the native diff and the updated draft revision. |
| `capcut_render` | Render the current draft to an MP4 with the shipped FFmpeg. |

### Why the engine runs in its own process

The shipped engine prints diagnostics on stdout. Under stdio MCP that would
corrupt the JSON-RPC framing. The shipped application solves this the same way:
the engine runs in its own process and the caller talks to it over a local
socket.

```
mcp-native.mjs  (MCP stdio)  ──socket──>  host.mjs  ──>  videoeditor_addon.node
```

`src/native/host.mjs` owns the engine and serves a line-delimited JSON
protocol; `src/native/client.mjs` spawns it and connects.

### Verified through the MCP surface

`test/mcp.test.mjs` starts the real MCP server, connects a real MCP client and
drives the real engine:

- the five tools are advertised with schemas and descriptions
- `capcut_capabilities` reports 199 operations and the parameter conventions
- `capcut_state` reports `status: ready` and a live draft summary
- `capcut_edit` mutates the draft and returns the native diff
- `capcut_render` writes a playable H.264 file
- a missing required parameter returns `segment_id_required`
- an operation outside the catalogue returns `unsupported_operation`

---

## Rendering

`capcut_render` renders the canonical native draft with the FFmpeg binary
shipped inside the CapCut installation.

```sh
node src/lyra-native.mjs --operation render --output C:/out/video.mp4
```

Through MCP:

```
capcut_edit({operation:"video.add", params:{path:"C:/media/clip.mp4", sourceDuration:3000000}})
capcut_render({output:"C:/out/video.mp4"})
```

### What it does

- Composes the draft canvas: a generated color base at the declared canvas size,
  then every video and sticker segment trimmed to its source range, scaled and
  placed at its timeline position.
- Mixes audio tracks with `adelay` and `amix`.
- Rasterizes text layers and composites them with `overlay`.
- Encodes with `h264_nvenc` by default; `h264_amf`, `h264_qsv` and `h264_mf`
  are the alternatives.

### The shipped build has no `drawtext`

The FFmpeg binary in the CapCut installation is compiled without
libfreetype, so it has no `drawtext` filter and no `ass` or `subtitles`
filter. Text layers are therefore rasterized by `src/native/text-overlay.mjs`
into RGBA PNG images with a built-in stroke font, and composited with
`overlay`. The glyph set is ASCII 32..126; a character outside it renders as
`?`. System fonts are not loaded.

### Verified

`test/render.test.mjs` renders the real draft and checks the result:

- the plan names the encoder, the trims and the overlays
- the rendered file is H.264, 1920x1080, 30 fps, and matches the draft duration
- a text layer is rasterized and overlaid

---

## Native edition — the real engine

### What it does

`src/native/editor.mjs` loads the shipped addon from the local CapCut
installation and drives it directly:

```
initialize({ modelsDir, algorithmConfigPath })  ->  { admissible: true, ... }
invoke({ domain, operation, params, sessionId }) ->  { accepted, diff, ... }
```

Recovered domains: `system`, `player`, `draft`, `edit`, `job`, `voice_input`.

The `edit` domain is the editor. It exposes **200+ operations** across 19
groups, and every one mutates the real native draft and returns a JSON diff
against the draft root:

| Group | Operations |
| --- | --- |
| `draft` | 14 |
| `track` | 4 |
| `segment` | 19 |
| `video` | 68 |
| `audio` | 25 |
| `text` | 16 |
| `textTemplate` | 7 |
| `sticker` | 6 |
| `effect` / `filter` / `adjustment` | 7 |
| `keyframe` | 3 |
| `template` / `templateCombination` | 6 |
| `attachment` | 14 |
| `story` | 12 |
| `undoRedo` | 6 |
| `batch` | 3 |

### Verified native behavior

Confirmed by the test suite in `test/native.test.mjs`:

- The addon initializes and reports `admissible: true`.
- A `player` session of kind `draft` is created (`ve-session-N`).
- A `draft_content.json` with a real MP4 loads and reports
  `status: ready`, `durationUs: 3000000`, `frameWidth: 640`,
  `frameHeight: 360`.
- `segment.split` mutates the draft and the diff reports the new segment count.
- `video.add` **decodes the media**: the canonical draft gains a second
  `materials.videos` entry with the probed `width: 640`, `height: 360`, the
  timeline grows to two segments, and `duration` recomputes to `6000000`.
- Missing required parameters are rejected with the native error codes
  (`segment_id_required`, `track_id_required`, `video_path_required`,
  `text_content_required`, `draft_snapshot_required`).

### Run it

```sh
cd app
npm test                       # 35 model tests + 8 native tests
node src/native-server.mjs     # http://localhost:8789 — the real engine
```

Desktop shortcut: **CapCut Native Engine**.

### Use the native CLI

```sh
node src/lyra-native.mjs --operation getState --output json
node src/lyra-native.mjs --operation segment.split --segment-id <id> --track-id <id> --splitpos 1500000
node src/lyra-native.mjs --operation video.add --path C:/media/clip.mp4 --sourceDuration 3000000 --startTime 3000000
node src/lyra-native.mjs --operation undoRedo.canUndo --output json
```

### Native HTTP API

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/state` | — |
| `GET` | `/api/draft` | — |
| `POST` | `/api/edit` | `{"operation":"segment.split","params":{...}}` |
| `POST` | `/api/video-add` | `{"path":"...","sourceDuration":3000000,"startTime":3000000}` |
| `POST` | `/api/frame` | `{"index":0}` |

### Native parameter conventions

The native `edit` domain validates its parameters and answers with a typed
error when one is missing. The shapes below were confirmed by observing those
errors and the resulting native draft. The full table is
`PARAM_CONVENTIONS` in `src/native/editor.mjs`.

| Operation | Required | Optional |
| --- | --- | --- |
| `segment.setTimeRange` | `segment_id` | `start_time`, `duration` |
| `segment.split` | `segment_id` | `track_id`, `splitpos`, `splittime` |
| `segment.visible` | `segment_id`, `visible` | — |
| `segment.setName` | `segment_id`, `name` | — |
| `segment.multiSegmentsSetTimeRange` | `segment_ids` | — |
| `track.mute` / `track.delete` | `track_id` | — |
| `track.updateTrackName` | `track_id`, `name` | — |
| `video.add` | `path` | `sourceDuration`, `sourceStartTime`, `startTime`, `trackIndex`, `segmentId` |
| `video.setSpeed` | `segment_id` | `speed` |
| `video.crop` | `segment_id` | `crop` |
| `video.setMatting` | `segment_id` | `matting` |
| `video.setOpacity` | `segment_id` | `opacity` |
| `video.setVolume` | `segment_id` | `volume` |
| `video.reverse` | `segment_id` | — |
| `audio.add` | `path` | `sourceDuration`, `startTime`, `trackIndex` |
| `text.add` | `content` | `seg_info`, `time_range`, `material` |
| `draft.setCanvasSize` | — | `width`, `height` |
| `draft.setDraftName` | `name` | requires `draftSnapshot` |
| `keyframe.add` | `segment_id` | `property`, `time`, `value` |

---

## Model edition — pure JavaScript

A reimplementation of the *observable contract* that the shipped application
exposes to an AI agent: a revision-checked timeline and canvas model, a
`lyra-cli-ipc` bridge with the recovered command surface and error codes, and a
local web UI. It runs without CapCut installed.

### What was recovered and reproduced

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

### Layout

```
app/
├── package.json
├── src/
│   ├── model/
│   │   ├── draft.mjs        draft document, revisions, error algebra
│   │   ├── timeline.mjs     tracks, segments, effects, keyframes, placement
│   │   └── canvas.mjs       canvas nodes, transforms, undo
│   ├── native/
│   │   ├── editor.mjs       loads videoeditor_addon.node, drives the real engine
│   │   ├── host.mjs         engine host process, line JSON over a local socket
│   │   ├── client.mjs       spawns the host and connects to it
│   │   ├── protocol.mjs     line-delimited JSON framing
│   │   ├── render.mjs       draft-to-FFmpeg planner
│   │   ├── render-draft.mjs runs the render
│   │   ├── text-overlay.mjs rasterizes text layers to PNG
│   │   └── lyra-native.mjs  native CLI argument and request handling
│   ├── mcp-native.mjs       MCP server over the native engine
│   ├── native-server.mjs    HTTP API over the real engine
│   ├── native.html/.js      web UI over the real engine
│   ├── lyra-cli-ipc.mjs     model command surface and JSON shapes
│   ├── cli.mjs              model CLI entry point
│   ├── lyra-native.mjs      native CLI entry point
│   ├── server.mjs           model HTTP API
│   ├── session.mjs          JSON-backed session store
│   ├── index.html           model web UI
│   └── app.js               model web UI logic
├── native/
│   ├── draft_content.json   draft with a real MP4 material
│   └── media/clip.mp4        3s 640x360 test clip, generated with CapCut's own ffmpeg
└── test/
    ├── editor.test.mjs       22 model contract tests
    ├── lyra-cli-ipc.test.mjs 13 model CLI tests
    ├── native.test.mjs       8 native engine tests
    ├── mcp.test.mjs          8 MCP surface tests
    └── render.test.mjs       11 renderer tests
```

### Run the model edition

```sh
cd app
npm test                 # 35 model tests
npm start                # http://localhost:8787
```

Desktop shortcut: **CapCut Reconstruction**.

### Model CLI

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

### Model HTTP API

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

## What neither edition does

- Neither reproduces CapCut's rendering, effect or AI behavior end to end. The
  ledger's 1,789 obligations remain open precisely because none of that
  behavior has been independently verified.
- Neither reproduces CapCut's proprietary protocol, cloud sync, or account
  system.
- The native edition renders only through the CPU fallback path in this
  environment: the CEF GPU transport reports `cefGpuState: unavailable` and
  `supportsGpuOutput: false`, so no GPU frames were observed.
- The native edition's `edit` domain does not expose the 850 lower-level
  `VeWrapper` methods that the UI reaches through C++ directly; it exposes the
  200+ behavior operations above. The lower-level surface remains a string
  inventory only.

## Evidence

Every claim above traces to a specific Evidence ID in the parent
[`../README.md`](../README.md). The reconstruction obligation ledger for each
analyzed application tree is in [`../ledger/`](../ledger/). The native contract
was recovered from the shipped `videoeditor-service.mjs` and `app-server.mjs`
runtime files of the local CapCut installation.
