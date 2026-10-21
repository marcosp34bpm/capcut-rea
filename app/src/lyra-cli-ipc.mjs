/**
 * `lyra-cli-ipc` reconstruction.
 *
 * The shipped CapCut 9.6 application exposes its editor to an agent through
 * `lyra-cli-ipc`, a Bun/Node script that forwards JSON requests over a local
 * socket and prints JSON on stdout. The packaged `canvas-node-cli` and
 * `timeline-draft-cli` skills document the command groups, the JSON fields and
 * the error codes reproduced here.
 */

import { ContractError } from "./model/draft.mjs";
import {
  attachAsset,
  createNode,
  deleteNode,
  duplicateNode,
  moveNode,
  transformNode,
  updateNode,
} from "./model/canvas.mjs";
import {
  addTrack,
  addVideo,
  arrangeTimelineTracks,
  insertDraftIntoTimeline,
  moveTrack,
  splitSegment,
} from "./model/timeline.mjs";

/**
 * Parse `--key value` and `--flag` style arguments.
 *
 * @param {string[]} argv raw arguments
 * @returns {Record<string, string | boolean>} parsed arguments
 */
export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

/**
 * Convert one CLI argument into a number when it looks numeric.
 *
 * @param {string | boolean | undefined} value raw value
 * @returns {number | null} the numeric value or null
 */
export function toNumber(value) {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Build the capability document advertised by `canvas capabilities`.
 *
 * @param {object} draft current draft
 * @returns {object} the capability document
 */
export function canvasCapabilities(draft) {
  return {
    schema: "agent-hub.canvas-capabilities.v1",
    canvas_revision: draft.canvasRevision,
    commands: [
      "canvas capabilities",
      "canvas asset list",
      "canvas asset get",
      "canvas node list",
      "canvas node create",
      "canvas node update",
      "canvas node delete",
      "canvas node transform",
      "canvas node move",
      "canvas node duplicate",
      "canvas node frame",
      "canvas node unframe",
      "timeline add-draft",
      "timeline add-track",
      "timeline add-video",
      "timeline split-segment",
      "timeline arrange-tracks",
      "timeline move-track",
    ],
    node_types: ["frame", "media", "text", "sticker", "group"],
    asset_kinds: ["draft", "video", "audio", "image", "font", "effect"],
    concurrency: {
      mode: "optimistic",
      node_revision_field: "revision",
      canvas_revision_field: "canvas_revision",
      dry_run_supported: true,
    },
  };
}

/**
 * Dispatch one command against a draft.
 *
 * @param {object} draft current draft
 * @param {string[]} argv command arguments after the command group
 * @returns {object} the command result
 */
export function dispatch(draft, argv) {
  const args = parseArgs(argv);
  const group = argv[0];
  const action = argv[1];
  if (group === "canvas" && action === "capabilities") {
    return canvasCapabilities(draft);
  }
  if (group === "canvas" && action === "asset") {
    return canvasAsset(draft, argv[2], args);
  }
  if (group === "canvas" && action === "node") {
    return canvasNode(draft, argv[2], args);
  }
  if (group === "timeline") {
    return timelineCommand(draft, action, args);
  }
  throw new ContractError(
    "cli_unknown_command",
    `unknown command: ${group ?? ""} ${action ?? ""}`.trim(),
    { command: [group, action].filter(Boolean).join(" ") },
  );
}

const canvasAsset = (draft, action, args) => {
  if (action === "list") {
    const kind = typeof args.kind === "string" ? args.kind : null;
    return {
      results: draft.assets
        .filter((asset) => kind === null || asset.kind === kind)
        .map((asset) => ({
          asset_id: asset.assetId,
          revision: asset.revision,
          status: asset.status,
          kind: asset.kind,
          name: asset.name,
        })),
    };
  }
  if (action === "get") {
    const assetId = typeof args.id === "string" ? args.id : null;
    const asset = draft.assets.find((candidate) => candidate.assetId === assetId);
    if (asset === undefined) {
      throw new ContractError(
        "canvas_cli_missing_asset_id",
        `asset not found: ${assetId}`,
        { missingAssetIds: [assetId] },
      );
    }
    return {
      asset_id: asset.assetId,
      revision: asset.revision,
      status: asset.status,
      kind: asset.kind,
      name: asset.name,
      local_path_status: asset.localPath === null ? "unavailable" : "available",
      ...(args["include-local-path"] === true
        ? { local_path: asset.localPath }
        : {}),
    };
  }
  throw new ContractError("cli_unknown_command", `unknown canvas asset action: ${action}`);
};

const canvasNode = (draft, action, args) => {
  const objectId = typeof args.id === "string" ? args.id : null;
  const expectedRevision = toNumber(args["expected-revision"]);
  const expectedCanvasRevision = toNumber(args["expected-canvas-revision"]);
  const dryRun = args["dry-run"] === true;
  const shared = { objectId, expectedRevision, expectedCanvasRevision, dryRun };

  switch (action) {
    case "list":
      return {
        canvas_revision: draft.canvasRevision,
        page_ids: draft.canvas.nodes.map((node) => node.objectId),
        data: {
          nodes: draft.canvas.nodes.map((node) => ({
            object_id: node.objectId,
            revision: node.revision,
            parent_frame_id: node.parentFrameId,
            layout: node.layout,
            label: node.label,
            type: node.type,
            asset_id: node.assetId,
          })),
        },
      };
    case "create": {
      const node = createNode(draft, {
        type: typeof args.type === "string" ? args.type : "text",
        label: typeof args.label === "string" ? args.label : undefined,
        assetId: typeof args["asset-id"] === "string" ? args["asset-id"] : null,
        dryRun,
      });
      return {
        dryRun,
        results: [{ node_id: node.objectId, revision: node.revision }],
      };
    }
    case "update":
      return toResult(
        updateNode(draft, {
          ...shared,
          label: typeof args.label === "string" ? args.label : undefined,
          content: typeof args.content === "string" ? args.content : undefined,
        }),
      );
    case "delete":
      return toResult(deleteNode(draft, shared));
    case "transform":
      return toResult(
        transformNode(draft, {
          ...shared,
          delta: {
            x: toNumber(args["delta-x"]) ?? undefined,
            y: toNumber(args["delta-y"]) ?? undefined,
            width: toNumber(args["delta-width"]) ?? undefined,
            height: toNumber(args["delta-height"]) ?? undefined,
            rotation: toNumber(args["delta-rotation"]) ?? undefined,
            scale: toNumber(args["delta-scale"]) ?? undefined,
          },
        }),
      );
    case "move":
      return toResult(
        moveNode(draft, {
          ...shared,
          parentFrameId:
            typeof args["parent-frame-id"] === "string"
              ? args["parent-frame-id"]
              : null,
        }),
      );
    case "duplicate":
      return toResult(duplicateNode(draft, shared));
    case "attach-asset":
      return toResult(
        attachAsset(draft, {
          ...shared,
          assetId: typeof args["asset-id"] === "string" ? args["asset-id"] : null,
        }),
      );
    default:
      throw new ContractError(
        "cli_unknown_command",
        `unknown canvas node action: ${action}`,
      );
  }
};

const toResult = (value) => ({
  dryRun: value.dryRun,
  results: [
    {
      node_id: value.nodeId,
      revision: value.revision,
      ...(value.sourceNodeId === undefined ? {} : { source_node_id: value.sourceNodeId }),
    },
  ],
});

const timelineCommand = (draft, action, args) => {
  switch (action) {
    case "add-draft":
      return insertDraftIntoTimeline(draft, {
        assetId: typeof args["asset-id"] === "string" ? args["asset-id"] : null,
        expectedAssetRevision: toNumber(args["expected-asset-revision"]),
        targetTimelineId:
          typeof args["target-timeline-id"] === "string"
            ? args["target-timeline-id"]
            : null,
        expectedTimelineRevision: toNumber(args["expected-timeline-revision"]),
        requestId:
          typeof args["request-id"] === "string" ? args["request-id"] : null,
        representation: args.representation === "nested" ? "nested" : "expanded",
        placement: args.placement === "at" ? "at" : "append",
        positionUs: toNumber(args["position-us"]),
        collision: args.collision === "overwrite" ? "overwrite" : "ripple",
        dryRun: args["dry-run"] === true,
      });
    case "add-track": {
      const track = addTrack(draft, {
        type: typeof args.type === "string" ? args.type : "video",
        name: typeof args.name === "string" ? args.name : undefined,
      });
      return { results: [{ track_id: track.id, type: track.type }] };
    }
    case "add-video": {
      const segment = addVideo(draft, {
        trackId: typeof args["track-id"] === "string" ? args["track-id"] : null,
        assetId: typeof args["asset-id"] === "string" ? args["asset-id"] : null,
        name: typeof args.name === "string" ? args.name : undefined,
        sourceDurationUs: toNumber(args["source-duration-us"]) ?? 0,
        timelineDurationUs: toNumber(args["timeline-duration-us"]) ?? 0,
      });
      return { results: [{ segment_id: segment.id }] };
    }
    case "split-segment": {
      const { left, right } = splitSegment(draft, {
        trackId: typeof args["track-id"] === "string" ? args["track-id"] : null,
        segmentId: typeof args["segment-id"] === "string" ? args["segment-id"] : null,
        offsetUs: toNumber(args["offset-us"]) ?? 0,
      });
      return { results: [{ segment_id: left.id }, { segment_id: right.id }] };
    }
    case "arrange-tracks":
      return {
        results: [{ track_ids: arrangeTimelineTracks(draft, {
          order: typeof args.order === "string" ? args.order.split(",") : [],
        }) }],
      };
    case "move-track":
      return {
        results: [{ track_ids: moveTrack(draft, {
          trackId: typeof args["track-id"] === "string" ? args["track-id"] : null,
          toIndex: toNumber(args["to-index"]) ?? 0,
        }) }],
      };
    default:
      throw new ContractError(
        "cli_unknown_command",
        `unknown timeline action: ${action}`,
      );
  }
};
