/**
 * Contract tests for the MCP surface over the native engine.
 *
 * These start the real MCP server, connect a real MCP client, and drive the
 * real shipped engine. They are skipped when CapCut is not installed.
 */

import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const CAPCUT_ROOT =
  process.env.CAPCUT_ROOT ??
  "C:\\Users\\marco\\AppData\\Local\\CapCut\\Apps\\9.6.0.4097";
const SERVER = "C:\\Users\\marco\\Documents\\capcut-rea\\app\\src\\mcp-native.mjs";
const available =
  existsSync(`${CAPCUT_ROOT}\\videoeditor_addon.node`) && existsSync(SERVER);
const skip = available ? false : "the local CapCut installation is not present";

const connect = async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    stderr: "ignore",
    env: { ...process.env, CAPCUT_ROOT },
  });
  const client = new Client({ name: "capcut-native-test", version: "0.1.0" });
  await client.connect(transport);
  return client;
};

test("the MCP server advertises a compact tool surface", { skip }, async () => {
  const client = await connect();
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "capcut_capabilities",
      "capcut_draft",
      "capcut_edit",
      "capcut_render",
      "capcut_state",
    ]);
    for (const tool of tools.tools) {
      assert.ok(tool.description.length > 40);
      assert.ok(tool.inputSchema);
    }
  } finally {
    await client.close();
  }
});

test("capcut_capabilities reports the engine and its operation catalogue", { skip }, async () => {
  const client = await connect();
  try {
    const result = await client.callTool({
      name: "capcut_capabilities",
      arguments: { group: "segment" },
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.engine, "capcut-native");
    assert.equal(payload.operationCount, 199);
    assert.ok(payload.groups.segment.includes("segment.split"));
    assert.ok(payload.parameterConventions["video.add"].required.includes("path"));
  } finally {
    await client.close();
  }
});

test("capcut_state reports the live native player state", { skip }, async () => {
  const client = await connect();
  try {
    const result = await client.callTool({
      name: "capcut_state",
      arguments: {},
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.state.status, "ready");
    assert.equal(payload.state.kind, "draft");
    assert.ok(payload.draft.tracks.length > 0);
  } finally {
    await client.close();
  }
});

test("capcut_edit mutates the real draft and the diff follows", { skip }, async () => {
  const client = await connect();
  try {
    const result = await client.callTool({
      name: "capcut_edit",
      arguments: {
        operation: "segment.split",
        params: { segment_id: "33333333333333333333333333333333" },
      },
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.accepted, true);
    assert.equal(payload.actionKey, "segment.split");
    assert.ok(payload.diff.operations.length > 0);
    assert.ok(payload.draft.tracks[0].segments.length >= 2);
  } finally {
    await client.close();
  }
});

test("a missing required parameter returns a typed native error", { skip }, async () => {
  const client = await connect();
  try {
    const result = await client.callTool({
      name: "capcut_edit",
      arguments: { operation: "segment.setTimeRange", params: {} },
    });
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.error.code, "segment_id_required");
  } finally {
    await client.close();
  }
});

test("an operation outside the catalogue is refused", { skip }, async () => {
  const client = await connect();
  try {
    const result = await client.callTool({
      name: "capcut_edit",
      arguments: { operation: "segment.notAnOperation", params: {} },
    });
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.error.code, "unsupported_operation");
  } finally {
    await client.close();
  }
});

test("capcut_draft returns the canonical native draft", { skip }, async () => {
  const client = await connect();
  try {
    const result = await client.callTool({
      name: "capcut_draft",
      arguments: { summarize: true },
    });
    const payload = JSON.parse(result.content[0].text);
    assert.ok(payload.summary.durationUs > 0);
    assert.ok(payload.summary.tracks.length > 0);
    assert.ok(payload.summary.materialCounts.videos > 0);
  } finally {
    await client.close();
  }
});

test("capcut_render produces a playable file", { skip }, async () => {
  const client = await connect();
  const output = join(tmpdir(), `capcut-mcp-render-${Date.now()}.mp4`);
  try {
    const result = await client.callTool({
      name: "capcut_render",
      arguments: { output },
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.ffmpeg.code, 0);
    assert.equal(payload.encoder, "h264_nvenc");
    assert.ok(existsSync(output));
    assert.ok(statSync(output).size > 10_000);
  } finally {
    await client.close();
  }
});
