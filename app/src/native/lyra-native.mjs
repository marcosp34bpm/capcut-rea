/**
 * `lyra-cli-ipc` — native edition.
 *
 * This bridge drives the real CapCut editor engine through the shipped
 * `videoeditor_addon.node` addon. The command surface, the operation
 * catalogue and the error codes were recovered with REA from the shipped
 * CapCut 9.6.0.4097 artifact; nothing here is guessed.
 *
 * Unlike the model-only reconstruction, every mutation here changes the real
 * native draft and every response carries the native diff.
 */

import { openNativeEditor, NativeError } from "./editor.mjs";

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
 * Convert one CLI argument into a boolean flag.
 *
 * @param {string | boolean | undefined} value raw value
 * @returns {boolean} the flag state
 */
export function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/**
 * Build the capability document the agent bridge advertises.
 *
 * @param {object} editor the native editor session
 * @returns {object} the capability document
 */
export const nativeCapabilities = (editor) => ({
  schema: "agent-hub.canvas-capabilities.v1",
  engine: "capcut-native",
  addonPath: editor.meta.addonPath,
  sessionId: editor.sessionId,
  draftRevision: editor.draftRevision,
  supportedDomains: ["system", "player", "draft", "edit", "job", "voice_input"],
  editOperations: Object.keys(editor.constructor === Object ? {} : {}),
  concurrency: {
    mode: "optimistic",
    node_revision_field: "revision",
    canvas_revision_field: "canvas_revision",
    dry_run_supported: false,
  },
});

/**
 * Read one JSON request from the process arguments.
 *
 * @param {Record<string, string | boolean>} args parsed arguments
 * @returns {object} the request envelope
 */
export const buildRequest = (args) => {
  const operation = typeof args.operation === "string" ? args.operation : null;
  if (operation === null) {
    throw new NativeError(
      "invalid_request",
      "--operation is required, for example --operation segment.split",
      {},
    );
  }
  const params = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "operation" || key === "output") continue;
    params[key] = toBoolean(value) && value === true ? true : value;
  }
  return { operation, params };
};

/**
 * Run one native request and return its result.
 *
 * @param {object} editor the native editor session
 * @param {Record<string, string | boolean>} args parsed arguments
 * @returns {Promise<object>} the operation result
 */
export const runNative = async (editor, args) => {
  const { operation, params } = buildRequest(args);
  if (operation === "getState") return editor.getState();
  if (operation === "getDraft") {
    const snapshot = editor.getDraftSnapshot();
    return snapshot === null
      ? { accepted: false, error: "draft_snapshot_unavailable" }
      : { accepted: true, draft: snapshot };
  }
  return editor.edit(operation, params);
};
