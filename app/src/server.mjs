#!/usr/bin/env node
/**
 * Local HTTP surface for the reconstructed editor.
 *
 * Exposes the same operations the agent bridge exposes, so a browser UI and an
 * agent can share one session and one revision history.
 */

import { createServer } from "node:http";

import { ContractError } from "./model/draft.mjs";
import {
  addCommonKeyframe,
  addTrack,
  addVideo,
  addVideoEffect,
  addVideoTransition,
  arrangeTimelineTracks,
  insertDraftIntoTimeline,
  moveSegment,
  moveTrack,
  muteAllTracks,
  removeSegment,
  splitSegment,
  updateSegmentDuration,
} from "./model/timeline.mjs";
import {
  attachAsset,
  createNode,
  deleteNode,
  duplicateNode,
  moveNode,
  transformNode,
  undo,
  updateNode,
} from "./model/canvas.mjs";
import { loadDraft, saveDraft } from "./session.mjs";

const PORT = Number(process.env.PORT ?? 8787);

const STATIC_ROUTES = {
  "/": "./index.html",
  "/index.html": "./index.html",
  "/app.js": "./app.js",
};

const OPERATIONS = {
  "timeline.add-track": (draft, args) => addTrack(draft, args),
  "timeline.add-video": (draft, args) => addVideo(draft, args),
  "timeline.split-segment": (draft, args) => splitSegment(draft, args),
  "timeline.remove-segment": (draft, args) => removeSegment(draft, args),
  "timeline.move-segment": (draft, args) => moveSegment(draft, args),
  "timeline.update-segment-duration": (draft, args) =>
    updateSegmentDuration(draft, args),
  "timeline.add-effect": (draft, args) => addVideoEffect(draft, args),
  "timeline.add-keyframe": (draft, args) => addCommonKeyframe(draft, args),
  "timeline.add-transition": (draft, args) => addVideoTransition(draft, args),
  "timeline.arrange-tracks": (draft, args) => arrangeTimelineTracks(draft, args),
  "timeline.move-track": (draft, args) => moveTrack(draft, args),
  "timeline.mute-all": (draft, args) => muteAllTracks(draft, args),
  "timeline.add-draft": (draft, args) => insertDraftIntoTimeline(draft, args),
  "canvas.create-node": (draft, args) => createNode(draft, args),
  "canvas.update-node": (draft, args) => updateNode(draft, args),
  "canvas.transform-node": (draft, args) => transformNode(draft, args),
  "canvas.move-node": (draft, args) => moveNode(draft, args),
  "canvas.duplicate-node": (draft, args) => duplicateNode(draft, args),
  "canvas.delete-node": (draft, args) => deleteNode(draft, args),
  "canvas.attach-asset": (draft, args) => attachAsset(draft, args),
  "editor.undo": (draft) => ({ undone: undo(draft) }),
};

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
    if (request.method === "GET" && url.pathname === "/api/state") {
      const draft = await loadDraft();
      send(response, 200, {
        draft,
        operations: Object.keys(OPERATIONS),
      });
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/")) {
      const action = url.pathname.slice("/api/".length);
      const operation = OPERATIONS[action];
      if (operation === undefined) {
        send(response, 404, { error: { code: "unknown_operation", action } });
        return;
      }
      const body = await readBody(request);
      const draft = await loadDraft();
      const result = operation(draft, body.args ?? body);
      await saveDraft(draft);
      send(response, 200, { result, draft });
      return;
    }
    if (request.method === "GET" && STATIC_ROUTES[url.pathname] !== undefined) {
      const { readFile } = await import("node:fs/promises");
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
    send(response, 404, { error: { code: "not_found", path: url.pathname } });
  } catch (cause) {
    if (cause instanceof ContractError) {
      send(response, 400, {
        error: { code: cause.code, message: cause.message, details: cause.details },
      });
      return;
    }
    send(response, 500, {
      error: { code: "unexpected_error", message: String(cause) },
    });
  }
});

server.listen(PORT, () => {
  process.stdout.write(`capcut-rea listening on http://localhost:${PORT}\n`);
});
