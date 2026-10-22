#!/usr/bin/env node
/**
 * Native engine host process.
 *
 * Loads the shipped `videoeditor_addon.node` and serves it over a local TCP
 * socket with a line-delimited JSON protocol. The caller owns the socket; this
 * process owns the native engine, so native console output can never corrupt
 * the caller's channel.
 *
 * Started by `src/native/client.mjs`; not meant to be run by hand.
 */

import { createServer } from "node:net";

import { openNativeEditor } from "./editor.mjs";
import { decode, encode } from "./protocol.mjs";

const port = Number(process.env.CAPCUT_NATIVE_HOST_PORT ?? 0);
const draftPath =
  process.env.CAPCUT_DRAFT_PATH ??
  "C:\\Users\\marco\\Documents\\capcut-rea\\app\\native\\draft_content.json";

const editor = openNativeEditor();
await editor.createSession("draft");
await editor.loadDraft(draftPath);

const server = createServer((socket) => {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) void handle(socket, line);
      index = buffer.indexOf("\n");
    }
  });
  socket.on("error", () => {
    // A disconnected client needs no recovery; the engine keeps running.
  });
});

const handle = async (socket, line) => {
  let request;
  try {
    request = decode(line);
  } catch (cause) {
    socket.write(
      encode({ ok: false, error: { code: "invalid_request", message: String(cause) } }),
    );
    return;
  }
  try {
    const result = await dispatch(request);
    socket.write(encode({ ok: true, id: request.id ?? null, result }));
  } catch (cause) {
    socket.write(
      encode({
        ok: false,
        id: request.id ?? null,
        error: {
          code: cause.code ?? "native_request_failed",
          message: cause.message ?? String(cause),
          details: cause.details ?? {},
        },
      }),
    );
  }
};

const dispatch = async (request) => {
  switch (request.method) {
    case "ping":
      return { pong: true };
    case "state":
      return editor.getState();
    case "draft":
      return editor.readDraft();
    case "edit":
      return editor.edit(request.operation, request.params ?? {});
    case "snapshot":
      return editor.getDraftSnapshot();
    case "operations":
      return { operations: request.operations ?? [] };
    default:
      throw Object.assign(new Error(`unknown method: ${request.method}`), {
        code: "unknown_method",
      });
  }
};

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(
    encode({
      ready: true,
      port: address.port,
      sessionId: editor.sessionId,
      addonPath: editor.meta.addonPath,
      capcutRoot: editor.meta.capcutRoot,
    }),
  );
});

const shutdown = async () => {
  server.close();
  await editor.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
