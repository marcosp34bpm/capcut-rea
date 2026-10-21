#!/usr/bin/env node
/**
 * Native HTTP surface.
 *
 * Serves the real CapCut editor engine through the shipped
 * `videoeditor_addon.node`. Every route drives the native `player` and `edit`
 * domains, so the browser UI edits the actual native draft.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

import { openNativeEditor, EDIT_OPERATION_KEYS } from "./native/editor.mjs";
import { parseArgs, toNumber } from "./native/lyra-native.mjs";

const PORT = Number(process.env.PORT ?? 8788);
const DRAFT_PATH =
  process.env.CAPCUT_DRAFT_PATH ??
  "C:\\Users\\marco\\Documents\\capcut-rea\\app\\native\\draft_content.json";

const STATIC_ROUTES = {
  "/": "./native.html",
  "/native.html": "./native.html",
  "/native.js": "./native.js",
};

const editor = openNativeEditor();
await editor.createSession("draft");
await editor.loadDraft(DRAFT_PATH);

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim().length > 0 ? JSON.parse(raw) : {};
};

const send = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
    if (request.method === "GET" && STATIC_ROUTES[url.pathname] !== undefined) {
      const file = await readFile(
        new URL(STATIC_ROUTES[url.pathname], import.meta.url),
        "utf8",
      );
      response.writeHead(200, {
        "content-type": STATIC_ROUTES[url.pathname].endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : "text/html; charset=utf-8",
      });
      response.end(file);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      const state = await editor.getState();
      send(response, 200, {
        engine: "capcut-native",
        addonPath: editor.meta.addonPath,
        sessionId: editor.sessionId,
        draftRevision: editor.draftRevision,
        state,
        operations: EDIT_OPERATION_KEYS,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/edit") {
      const body = await readBody(request);
      const operation = body.operation;
      const result = await editor.edit(operation, body.params ?? {});
      const snapshot = editor.getDraftSnapshot();
      send(response, 200, {
        result,
        draft: snapshot,
        draftRevision: editor.draftRevision,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/draft") {
      const draft = await editor.readDraft();
      send(response, 200, { draft, draftRevision: editor.draftRevision });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/video-add") {
      const body = await readBody(request);
      const result = await editor.edit("video.add", {
        path: body.path,
        sourceDuration: body.sourceDuration ?? 0,
        sourceStartTime: body.sourceStartTime ?? 0,
        startTime: body.startTime ?? 0,
        trackIndex: body.trackIndex ?? 0,
      });
      send(response, 200, {
        result,
        draft: editor.getDraftSnapshot(),
        draftRevision: editor.draftRevision,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/frame") {
      const body = await readBody(request);
      const frame = await editor.readFrame(toNumber(body.index) ?? 0);
      send(response, 200, { frame });
      return;
    }
    send(response, 404, { error: { code: "not_found", path: url.pathname } });
  } catch (cause) {
    send(response, 400, {
      error: {
        code: cause.code ?? "unexpected_error",
        message: cause.message ?? String(cause),
        details: cause.details ?? {},
      },
    });
  }
});

server.listen(PORT, () => {
  process.stdout.write(
    `capcut-rea native engine listening on http://localhost:${PORT}\n`,
  );
});

const shutdown = async () => {
  server.close();
  await editor.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
