#!/usr/bin/env node
/**
 * `lyra-cli-ipc` — native edition.
 *
 * Drives the real CapCut editor engine through the shipped
 * `videoeditor_addon.node` addon.
 *
 * Usage:
 *   lyra-cli-ipc --operation getState --output json
 *   lyra-cli-ipc --operation segment.split --segment-id <id> --offset-us 1000000
 *   lyra-cli-ipc --operation video.add --videos '[{"path":"C:\\media\\clip.mp4"}]'
 *
 * The session loads the draft at `CAPCUT_DRAFT_PATH` (default: the bundled
 * `native/draft_content.json`).
 */

import { openNativeEditor } from "./native/editor.mjs";
import { parseArgs, runNative } from "./native/lyra-native.mjs";


const HELP = [
  "lyra-cli-ipc — native CapCut editor bridge (REA reconstruction)",
  "",
  "Drives the real shipped videoeditor_addon.node through its",
  "initialize/invoke contract. Requires the local CapCut installation.",
  "",
  "Usage:",
  '  lyra-cli-ipc --operation getState --output json',
  '  lyra-cli-ipc --operation segment.split --segment-id <id> --offset-us 1000000',
  '  lyra-cli-ipc --operation video.setSpeed --segment-id <id> --speed 2',
  "",
  "Environment:",
  "  CAPCUT_ROOT        CapCut installation root (default: the 9.6.0.4097 build)",
  "  CAPCUT_DRAFT_PATH  draft_content.json to load (default: the bundled draft)",
  "",
].join("\n");

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  const args = parseArgs(argv);
  const draftPath =
    process.env.CAPCUT_DRAFT_PATH ??
    "C:\\Users\\marco\\Documents\\capcut-rea\\app\\native\\draft_content.json";
  const editor = openNativeEditor();
  try {
    await editor.createSession("draft");
    await editor.loadDraft(draftPath);
    const result = await runNative(editor, args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await editor.close();
  }
};

try {
  await main();
} catch (cause) {
  const code = cause.code ?? "cli_unexpected_error";
  const message = cause.message ?? String(cause);
  process.stderr.write(
    `${JSON.stringify({ error: { code, message, details: cause.details ?? {} } })}\n`,
  );
  process.exitCode = 2;
}
