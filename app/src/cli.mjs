#!/usr/bin/env node
/**
 * `lyra-cli-ipc` command-line entry point.
 *
 * Mirrors the shipped CapCut 9.6 launcher: JSON goes in on stdin or as
 * arguments, JSON comes out on stdout, and errors go to stderr with a stable
 * `error.code`.
 */

import { ContractError } from "./model/draft.mjs";
import { dispatch, parseArgs } from "./lyra-cli-ipc.mjs";
import { session } from "./session.mjs";

const HELP = [
  "lyra-cli-ipc — reconstructed CapCut editor agent bridge",
  "",
  "Usage:",
  "  lyra-cli-ipc canvas capabilities --output json",
  "  lyra-cli-ipc canvas asset list --kind draft --output json",
  "  lyra-cli-ipc canvas asset get --id <asset-id> --output json",
  "  lyra-cli-ipc canvas node list --output json",
  "  lyra-cli-ipc timeline add-draft --asset-id <asset-id> \\",
  "      --expected-asset-revision <revision> [--dry-run] --output json",
  "",
  "Read one JSON request on stdin with --stdin:",
  '  {"commandId":"op-1","action":"timeline.add-draft","args":{...}}',
  "",
].join("\n");

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const runStdinRequest = async (request) => {
  const args = request.args ?? {};
  const argv = ["timeline", "add-draft"];
  for (const [key, value] of Object.entries(args)) {
    argv.push(`--${key}`, String(value));
  }
  return session((draft) => dispatch(draft, argv));
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--stdin")) {
    const raw = await readStdin();
    const request = raw.trim().length > 0 ? JSON.parse(raw) : { args: {} };
    const result = await runStdinRequest(request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const args = parseArgs(argv);
  const result = await session((draft) => dispatch(draft, argv));
  const output = args.output === "json" ? JSON.stringify(result) : JSON.stringify(result, null, 2);
  process.stdout.write(`${output}\n`);
};

try {
  await main();
} catch (cause) {
  if (cause instanceof ContractError) {
    process.stderr.write(
      `${JSON.stringify({ error: { code: cause.code, message: cause.message, details: cause.details } })}\n`,
    );
    process.exitCode = 2;
  } else {
    process.stderr.write(
      `${JSON.stringify({ error: { code: "cli_unexpected_error", message: String(cause) } })}\n`,
    );
    process.exitCode = 1;
  }
}
