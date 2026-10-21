# CapCut desktop application — REA analysis

Reverse-engineering analysis of the locally installed **CapCut 9.6.0.4097**
(Windows x64) using the [REA](https://github.com/morluto/rea) reverse-engineering
toolchain installed at `C:\Users\marco\Documents\Projeto Padrão`.

Everything here is derived from the shipped artifact on this machine. No source
code was available; every claim is a static observation with an Evidence ID, or
an explicit inference labelled as such.

## Target identity

| Property | Value |
| --- | --- |
| Product | CapCut |
| Version | 9.6.0.4097 |
| Install root | `C:\Users\marco\AppData\Local\CapCut\Apps\9.6.0.4097` |
| Install root SHA-256 | `d68591b49dc46c70af0effe00a6b5faca06d5bc59d4de72183a48c4d5f007224` |
| Launcher | `Apps\CapCut.exe` (4.97 MB) |
| Application binary | `Apps\9.6.0.4097\CapCut.exe` (90 KB) |
| Architecture | x86_64 |
| User data | `C:\Users\marco\AppData\Local\CapCut\User Data` |

## Architecture observed

CapCut 9.6 is a **C++/Qt 6 + CEF desktop application** with a large bundled
JavaScript application layer and an embedded AI agent runtime.

```
CapCut.exe (launcher)
└── 9.6.0.4097/
    ├── CapCut.exe, cccreator.dll (158 MB), videoeditor.dll (72 MB),
    │   VECreator.dll (271 MB), lens.dll (88 MB), lynx.dll (24 MB)
    ├── Qt6*.dll, Qt5Compat, QtQml, QtQuick
    ├── cef/                          CEF webview runtime
    ├── lynx_core.js, lynx_core_dev.js   Lynx (ByteDance UI runtime)
    ├── ffmpeg.exe, avcodec-61, avformat-61, svt_av1, jxl, dav1d
    ├── deepagents_capi.dll (42 MB), DeepAgentsService.dll
    ├── videoeditor_addon.node (3.6 MB)   Node-API native editor addon
    ├── agent_runtime_addon.node (521 KB)  Node-API agent runtime addon
    ├── ttnet_frontier_addon.node         TTNet network addon
    ├── bun.exe (107 MB)                  JavaScript runtime for the agent
    └── Resources/
        ├── common_agent/                 embedded AI agent package
        │   ├── package-manifest.json     manifest + hashes
        │   ├── app/commonagent/          agent UI (React/Vite build)
        │   ├── app/video-studio/         video studio UI (React/Vite build)
        │   ├── runtime/                  Node/Bun runtime (5 .mjs files)
        │   ├── skills/                   4 packaged agent skills
        │   ├── prompts/system.md
        │   └── resources/lyra-cli-ipc/
        ├── lumi_js_resources/            Lynx JS bundles (feature, video)
        └── lynx_config/                  per-page Lynx templates
```

### The embedded AI agent (`common_agent`)

The most architecturally interesting part of CapCut 9.6 is a packaged AI agent
that drives the video editor. `package-manifest.json` pins it as
`common-agent-win-x64-cmake`, `commonAgentVersion` `0.1.0`, package stamp
`20261008043846`.

The agent runtime is Node/Bun-based (`runtime/app-server.mjs` is 2.0 MB,
`common-agent-tool-worker.mjs` is 368 KB) and talks to three Node-API native
addons:

| Addon | Capability ID | Purpose |
| --- | --- | --- |
| `videoeditor_addon.node` | `common-agent.videoeditor-addon.v1` | Editor timeline/canvas mutation |
| `agent_runtime_addon.node` | `common-agent.runtime-addon.v1` | Agent process/runtime control |
| `ttnet_frontier_addon.node` | `common-agent.frontier.v1` | TTNet networking (method ID 100001) |

The agent reaches the editor through a CLI called `lyra-cli-ipc`
(`bin/lyra-cli-ipc.cmd` → `resources/lyra-cli-ipc/lyraCliIpcClient.mjs`),
with `canvas` and `timeline` command groups.

### Packaged agent skills

| Skill | Purpose |
| --- | --- |
| `capcut-browser` | Managed browser control for the agent (open/snapshot/click/fill) |
| `canvas-node-cli` | Read and mutate persistent Canvas nodes via `lyra-cli-ipc canvas` |
| `timeline-draft-cli` | Insert a draft Asset into the focused native timeline |
| `lark-doc` | Lark/Feishu document creation, fetch, XML/word/stat editing |

`canvas-node-cli` and `timeline-draft-cli` document an **optimistic
concurrency contract**: every mutation carries `revision` plus
`--expected-revision` (or `--expected-canvas-revision` /
`--expected-timeline-revision`), and every mutation supports `--dry-run`
returning `dry_run: true`. Conflict errors are typed
(`canvas_cli_revision_conflict`, `canvas_cli_canvas_revision_conflict`,
`canvas_cli_asset_revision_conflict`, `timeline_cli_*conflict`).

The agent's own system prompt is deliberately not shipped: `prompts/system.md`
states the executable prompt is resolved per-turn by the active provider, and
the packaged file "must not override provider-owned prompts by itself".

## Native editor API surface

`videoeditor_addon.node` (SHA-256
`25c89e933a9065f031fa4dcab518f62f33ea29428aa02d9159b0057e14922616`) is the
Node-API addon exposing the editor to the agent runtime.

- PE x86_64, 8 segments, `.text` 2.73 MB
- **10,906 procedures**, **7,780 defined strings**, 73,075 names
- PDB reference `videoeditor_addon.pdb`, GUID `fd176c7b-c3d7-44f6-93c0-84489216874f`

A regex search over the Ghidra-defined string inventory yields **850 distinct
method-like names**. Grouped inventory:
[`native/videoeditor-addon-methods.md`](native/videoeditor-addon-methods.md).

| Group | Count |
| --- | --- |
| Segment editing | 140 |
| Text and caption | 82 |
| AI and generative features | 78 |
| Effect, filter and adjustment | 53 |
| Application layer | 38 |
| Canvas and cover | 21 |
| Playback and preview | 17 |
| Material and asset | 16 |
| Template and cover preset | 16 |
| Keyframes and animation | 16 |
| Track and timeline | 15 |
| Render and export | 12 |
| Audio | 13 |
| Task and async lifecycle | 10 |
| Sticker and tracking | 8 |
| History and undo | 7 |

Representative names, grouped by what they imply about the editor model:

- **Timeline** — `arrangeTimelineTracks`, `setMainTimelineId`, `moveTrack`,
  `moveMainToSubVideo`, `matchCaptionTimeline`, `inspectMainTimeline`
- **Segments** — `splitSegment`, `mergeDraftTextSegment`, `moveSegment`,
  `updateSegmentDuration`, `updateVideoTimeRange`, `createPlaceholderOperation`
- **Text** — `addTextLayer`, `updateTextTemplateText`, `mergeRichText`,
  `splitTextTemplate`, `getFontIds`, `setTextCurveViewText`, `applyAiFont`
- **Effects** — `addVideoEffect`, `setFilter`, `addGlobalVideoEffect`,
  `setPictureAdjust`, `setBeauty`, `setChromaColor`, `setSuperResolution`
- **AI** — `addDigitalHuman`, `addTextToVideoMaterial`, `setAITranslateParam`,
  `updateLipSyncOutputPath`, `getAIShortsInfo`, `getAIClipperInfo`,
  `addVideoSmartMotion`, `applySmartCrop`, `queryAITransitionHistories`
- **Async tasks** — `createAsyncTasks`, `createAsyncTasksWithCallback`,
  `setupAsyncTaskPipelineListener`, `setOnTaskProgressCallback`,
  `setOnMergeTasksRetryCallback`
- **History** — `addHistoryChangeCallback`, `getUndoHistoryIdentifiers`,
  `getHistoryMergeChangeNodes`, `setHistoriesLimitConfig`

Two findings worth calling out:

1. The editor is **document/revision based, not imperative-only** — the
   `update*`/`set*Expected*` pattern and `timeline_revision`/`canvas_revision`
   fields show an optimistic concurrency model with rollback (`timeline_cli_rollback_failed`).
2. The AI surface is **not a separate service** — generative features
   (`addDigitalHuman`, `addTextToVideoMaterial`, `setAITranslateParam`) are
   first-class editor operations sharing the same segment/material model as
   manual edits.

## Reconstruction obligation ledger

`build_reconstruction_obligation_ledger` turns the authenticated Evidence into
a deterministic list of reconstruction claims. Each JavaScript application
Evidence record was analyzed on its own (REA canonicalizes a whole bundle into
one JSON string, and one CapCut application graph alone approaches the engine
string limit).

Ledgers: [`ledger/`](ledger/) — 6 ledgers, **1,789 obligations** total.

| Ledger | Subject | Obligations | Layers |
| --- | --- | --- | --- |
| `000` | commonagent | 450 | protocol 221, runtime 169, application 38, persistence 12, process 10 |
| `006` | video-studio | 61 | protocol 27, runtime 16, application 13, persistence 5 |
| `007` | runtime | 284 | runtime 134, application 101, protocol 47, persistence 1, cli 1 |
| `014` | runtime (complete) | 284 | runtime 134, application 101, protocol 47, persistence 1, cli 1 |
| `020` | commonagent (complete) | 445 | protocol 214, runtime 169, application 38, persistence 12, process 12 |
| `021` | commonagent (runtime) | 265 | protocol 184, runtime 51, application 10, persistence 12, process 8 |

Obligation families across all ledgers:

| Family | Count |
| --- | --- |
| endpoint | 710 |
| promise-ownership | 310 |
| parser-boundary | 301 |
| task-lifecycle | 300 |
| event | 44 |
| persistence | 41 |
| worker-lifecycle | 30 |
| request | 21 |
| timer | 19 |
| response | 9 |
| resource-lifecycle | 2 |
| configuration | 2 |

Sum: 1,789, matching the per-ledger totals above.

**Every obligation is `unowned` and `required_open`.** That is the correct
result: the ledger is fail-closed by design. An obligation closes only when a
manifest binding supplies a unique owner, the required parser/schema/domain
type, every required case fixture, and a passing verifier of comparable
authority. No reconstruction of CapCut has been implemented yet, so nothing
can close. Each ledger's `status` is `unknown` and graph coverage is `partial`.

## Evidence index

| Evidence ID | Operation | Subject |
| --- | --- | --- |
| `ev_d5191c7c6df26f737047e715fb08f8d02f3a0525bb11ef296130b6fb3df0ea60` | `inspect_desktop_application` | CapCut install root (400 entries) |
| `ev_d614c2433f1cef3e71f2e87d4cb8bacc36ca2d2492d9bdb465e8339099beda52` | `search_strings` (regex) | `videoeditor_addon.node` — 850 method names |
| `ev_7e0490f3c528a06f3db517ab49714ddb89da8131a518d7ddc3f967aa31d99e90` | `list_strings` | `videoeditor_addon.node` — 7,780 strings |
| `ev_e355fddfd7ec31fb125ed80127515b2491f4e7fcfab5629663444d3dcc40ef33` | `list_names` | `videoeditor_addon.node` — 73,075 names |
| `ev_79c63964ad7cc5641cb98e157ffec9031010061cc7b20c9dc7d16d5f71aa2ab8` | `binary_overview` | `videoeditor_addon.node` — 10,906 procedures |
| `ev_010c2eb098bf6861d550300212f8bbeed75c5d7bdd497040820b5dc343300281` | `analyze_javascript_application` | commonagent UI |
| `ev_3f81c3eb962e2fc624e05bd90bbdada3211ef1788c59126ecf0309323c58b4cb` | `analyze_javascript_application` | video-studio UI |
| `ev_40cc8c372cc53777a1400fead33aa83627f9d1876e0ee48e4365de6137d29915` | `analyze_javascript_application` | agent runtime |
| `ev_879da352fb59688305a1c1dc61654a24238353d89f3c8859b834a4fef09e27cb` | `analyze_javascript_application` (complete) | agent runtime |
| `ev_d66a02ddba4c38c6cab26d049eecddb1095ae2fd914bcf4734a393e5954be16d` | `analyze_javascript_application` | commonagent UI |
| `ev_e310c83151310b24d9223daba6c30ee98aa0956a1dd630224897be9074d3d43b` | `analyze_javascript_application` | commonagent UI |

Ledger Evidence IDs (one per generated ledger):

| Ledger | Evidence ID |
| --- | --- |
| `000` | `ev_f1ff3564e3a01b713a80ac4a1cf7081427f9756cc6dc4ab2f2beee6a724630ff` |
| `006` | `ev_9789326bfe8bf82b2add6657e9b472ab11320e1a9fed35960faa9e27ec41d2b1` |
| `007` | `ev_693e40efa4e63a1124832c87c17bbfd6d2c177e07bf471be081f998b659dc58f` |
| `014` | `ev_4a8b938819897cfd9b60e2e3745147b1189ecffa385c93a2e12d9793b7793585` |
| `020` | `ev_2c80ae4ac45c4c90593e1ddc9f19c12fc63d53b116bd363dc929814372946916` |
| `021` | `ev_0160a2202a06f872ce7de10f3a8b610e5f8382532fa0c06cb19baf2108009042` |

## Limitations

- All findings are **static**. Nothing was executed; no CapCut process was
  launched, no project file was created, no draft was opened or modified.
- The application graph coverage for every ledger is `partial`, and each
  ledger carries unresolved-node limitations. Candidate counts are therefore
  lower bounds, not totals.
- The JavaScript semantic graph reached its unknown-retention capacity
  (28,891 semantic unknowns in the agent runtime analysis), so semantic
  obligation candidates are incomplete.
- `index.html` inline JavaScript in the analyzed app directories was not
  analyzed.
- Only Ghidra-defined string data was observed; packed or undefined string
  bytes may be absent from the native inventory.
- The `videoeditor_addon.node` PDB was not available, so original symbol names
  and types may be missing.
- The CapCut skill Markdown files contain mixed-encoding text (Traditional
  Chinese) that rendered as mojibake under a Latin-1 read; only the
  English-language portions of `capcut-browser/SKILL.md` were read verbatim.
- The agent's executable system prompt is provider-owned and not present in the
  shipped artifact, so the agent's actual prompt-level behavior is unknown.

## Reproducing this analysis

The tools in [`tools/`](tools/) run against an exported REA Evidence bundle:

```sh
# 1. Split a large exported bundle into one file per Evidence record.
node tools/extract-bundle-records.mjs capcut-bundle.json records/

# 2. Build one reconstruction obligation ledger per candidate record.
node tools/capcut-ledger.mjs records/ ledgers/

# 3. Extract the grouped native method inventory.
node tools/extract-native-api.mjs records/019.json native/videoeditor-addon-methods.md
```

`tools/capcut-ledger.mjs` and `tools/extract-bundle-records.mjs` import from the
built REA runtime at `../dist/`, so run `npm run build:cached` in the REA
checkout first.
