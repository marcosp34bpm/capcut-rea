/**
 * Session store for the reconstructed editor agent.
 *
 * The shipped CapCut 9.6 application keeps its draft in a session that the
 * agent bridge reaches over a local socket. This reconstruction keeps the
 * same observable contract — one session, one draft, revision-checked
 * mutations — backed by a JSON file so the CLI and the local web UI share the
 * same state.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createDraft } from "./model/draft.mjs";

const DEFAULT_PATH = resolve(process.env.CAPCUT_REA_SESSION ?? "./session/draft.json");

/**
 * Read the persisted draft, creating a seed draft when none exists.
 *
 * @param {string} [sessionPath] session file path
 * @returns {Promise<object>} the draft
 */
export const loadDraft = async (sessionPath = DEFAULT_PATH) => {
  try {
    const raw = await readFile(sessionPath, "utf8");
    return JSON.parse(raw);
  } catch {
    const draft = createDraft({ name: "CapCut reconstruction session" });
    draft.assets = [
      {
        assetId: "asset-1",
        kind: "draft",
        name: "Sample draft",
        revision: 1,
        status: "ready",
        localPath: null,
        durationUs: 5_000_000,
      },
    ];
    await saveDraft(draft, sessionPath);
    return draft;
  }
};

/**
 * Persist a draft.
 *
 * @param {object} draft the draft to persist
 * @param {string} [sessionPath] session file path
 * @returns {Promise<void>} resolves once written
 */
export const saveDraft = async (draft, sessionPath = DEFAULT_PATH) => {
  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, JSON.stringify(draft, null, 2), "utf8");
};

/**
 * Run one mutation against the persisted draft and save the result.
 *
 * @param {(draft: object) => unknown} operation mutation to apply
 * @param {string} [sessionPath] session file path
 * @returns {Promise<unknown>} the operation result
 */
export const session = async (operation, sessionPath = DEFAULT_PATH) => {
  const draft = await loadDraft(sessionPath);
  const result = await operation(draft);
  await saveDraft(draft, sessionPath);
  return result;
};

export { DEFAULT_PATH };
