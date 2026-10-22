#!/usr/bin/env node
/**
 * MCP server for the native CapCut editor.
 *
 * Exposes the real shipped `videoeditor_addon.node` engine to an agent. The
 * native `edit` domain accepts 199 operations; registering one MCP tool per
 * operation would flood the agent's context, so the surface stays small:
 *
 *   capcut_capabilities  engine identity, operation catalogue, param conventions
 *   capcut_state         live player state and draft summary
 *   capcut_draft         the canonical native draft, optionally one section
 *   capcut_edit          run one native edit operation
 *
 * Every tool call drives the real engine and returns the native diff.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import {
  EDIT_OPERATIONS,
  EDIT_OPERATION_KEYS,
  NativeError,
  PARAM_CONVENTIONS,
} from "./native/editor.mjs";
import { openRemoteEditor } from "./native/client.mjs";

const DRAFT_PATH =
  process.env.CAPCUT_DRAFT_PATH ??
  "C:\\Users\\marco\\Documents\\capcut-rea\\app\\native\\draft_content.json";

/**
 * The native engine runs in its own process.
 *
 * The shipped engine prints diagnostics on stdout, which would corrupt the
 * stdio JSON-RPC framing. Running it in a host process keeps the caller's
 * stdout clean, exactly as the shipped application does.
 */
const editor = await openRemoteEditor({
  CAPCUT_DRAFT_PATH: DRAFT_PATH,
});

const server = new McpServer(
  { name: "capcut-native", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
const text = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const failure = (cause) => ({
  isError: true,
  content: [
    {
      type: "text",
      text: JSON.stringify(
        {
          error: {
            code: cause.code ?? "native_request_failed",
            message: cause.message ?? String(cause),
            details: cause.details ?? {},
          },
        },
        null,
        2,
      ),
    },
  ],
});

const summarizeDraft = (draft) => {
  if (draft === null || draft === undefined) return null;
  const tracks = (draft.tracks ?? []).map((track) => ({
    id: track.id,
    type: track.type,
    segments: (track.segments ?? []).map((segment) => ({
      id: segment.id,
      materialId: segment.material_id ?? null,
      sourceStartUs: segment.source_timerange?.start ?? null,
      sourceDurationUs: segment.source_timerange?.duration ?? null,
      targetStartUs: segment.target_timerange?.start ?? null,
      targetDurationUs: segment.target_timerange?.duration ?? null,
      speed: segment.speed ?? null,
      visible: segment.visible ?? null,
    })),
  }));
  const materials = draft.materials ?? {};
  return {
    id: draft.id ?? null,
    name: draft.name ?? null,
    durationUs: draft.duration ?? null,
    fps: draft.fps ?? null,
    canvas: draft.canvas_config ?? null,
    tracks,
    materialCounts: Object.fromEntries(
      Object.entries(materials)
        .filter(([, value]) => Array.isArray(value) && value.length > 0)
        .map(([key, value]) => [key, value.length]),
    ),
  };
};

server.registerTool(
  "capcut_capabilities",
  {
    title: "CapCut native engine capabilities",
    description:
      "Engine identity, the native edit operation catalogue by group, and the confirmed parameter shapes. Start here before running an edit.",
    inputSchema: z.object({
      group: z
        .string()
        .optional()
        .describe("Limit the catalogue to one group, for example segment or video."),
    }),
  },
  async ({ group }) => {
    const groups =
      group === undefined
        ? Object.fromEntries(
            Object.entries(EDIT_OPERATIONS).map(([key, operations]) => [
              key,
              operations.map((operation) => `${key}.${operation}`),
            ]),
          )
        : {
            [group]: (EDIT_OPERATIONS[group] ?? []).map(
              (operation) => `${group}.${operation}`,
            ),
          };
    return text({
      engine: "capcut-native",
      addonPath: editor.meta.addonPath,
      sessionId: editor.sessionId,
      draftPath: DRAFT_PATH,
      domains: ["system", "player", "draft", "edit", "job", "voice_input"],
      operationCount: EDIT_OPERATION_KEYS.length,
      groups,
      parameterConventions: PARAM_CONVENTIONS,
    });
  },
);

server.registerTool(
  "capcut_state",
  {
    title: "CapCut native player state",
    description:
      "Live native playback state: status, duration, frame size, GPU transport and the current draft summary.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const state = await editor.getState();
      const draft = await editor.readDraft();
      return text({
        sessionId: editor.sessionId,
        draftRevision: editor.draftRevision,
        state: {
          status: state.status,
          kind: state.kind,
          positionUs: state.positionUs,
          durationUs: state.durationUs,
          frameWidth: state.frameWidth,
          frameHeight: state.frameHeight,
          loop: state.loop,
          gpuState: state.gpuAdapterSelection?.cefGpuState ?? null,
          supportsGpuOutput: state.supportsGpuOutput ?? null,
          cpuFallbackLimits: state.cpuFallbackLimits ?? null,
        },
        draft: summarizeDraft(draft),
      });
    } catch (cause) {
      return failure(cause);
    }
  },
);

server.registerTool(
  "capcut_draft",
  {
    title: "CapCut native draft",
    description:
      "The canonical native draft document. Returns the whole draft by default, or one section: tracks, materials, canvas, keyframes or a single material list.",
    inputSchema: z.object({
      section: z
        .string()
        .optional()
        .describe(
          "One of: tracks, materials, canvas, keyframes, videos, texts, audios, stickers, effects.",
        ),
      summarize: z
        .boolean()
        .optional()
        .describe("Return only counts and ids instead of full content."),
    }),
  },
  async ({ section, summarize }) => {
    try {
      const draft = await editor.readDraft();
      if (draft === null) return text({ error: "draft_unavailable" });
      if (section !== undefined) {
        const value =
          section === "canvas"
            ? draft.canvas_config
            : section === "materials"
              ? summarize === true
                ? Object.fromEntries(
                    Object.entries(draft.materials ?? {}).map(([key, list]) => [
                      key,
                      Array.isArray(list) ? list.length : list === null ? null : typeof list,
                    ]),
                  )
                : draft.materials
              : section === "keyframes"
                ? draft.keyframes
                : (draft[section] ?? draft.materials?.[section]);
        return text({ section, value });
      }
      if (summarize === true) return text({ summary: summarizeDraft(draft) });
      return text({ draft });
    } catch (cause) {
      return failure(cause);
    }
  },
);

server.registerTool(
  "capcut_edit",
  {
    title: "Run a native CapCut edit operation",
    description:
      "Run one native edit operation against the real editor engine. The operation is a dotted key such as segment.split, video.add or undoRedo.undo; parameters are the confirmed native shapes. Returns the native diff and the updated draft revision.",
    inputSchema: z.object({
      operation: z
        .string()
        .describe(
          "Dotted native operation, for example segment.split or video.add. See capcut_capabilities.",
        ),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Native operation parameters, using the confirmed snake_case names."),
    }),
  },
  async ({ operation, params }) => {
    try {
      const result = await editor.edit(operation, params ?? {});
      const draft = await editor.getDraftSnapshot();
      return text({
        accepted: result.accepted === true,
        actionKey: result.actionKey ?? null,
        draftRevision: editor.draftRevision,
        diff: result.diff ?? null,
        draft: summarizeDraft(draft),
      });
    } catch (cause) {
      if (cause instanceof NativeError) return failure(cause);
      return failure(cause);
    }
  },
);

const shutdown = async () => {
  await editor.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

serveStdio(() => server);
