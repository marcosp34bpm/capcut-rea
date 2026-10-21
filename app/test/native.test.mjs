/**
 * Native engine contract tests.
 *
 * These tests drive the real shipped `videoeditor_addon.node` from the local
 * CapCut installation. They are skipped when CapCut is not installed, so the
 * suite still runs on a machine without CapCut.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import {
  EDIT_OPERATION_KEYS,
  NativeError,
  openNativeEditor,
  resolveCapCutRoot,
} from "../src/native/editor.mjs";

const CAPCUT_ROOT = resolveCapCutRoot();
const ADDON = `${CAPCUT_ROOT}\\videoeditor_addon.node`;
const DRAFT = "C:\\Users\\marco\\Documents\\capcut-rea\\app\\native\\draft_content.json";
const MEDIA = "C:/Users/marco/Documents/capcut-rea/app/native/media/clip.mp4";

const available = existsSync(ADDON) && existsSync(DRAFT);
const skip = available ? false : "the local CapCut installation is not present";

test("the operation catalogue covers every recovered domain", { skip }, () => {
  assert.ok(EDIT_OPERATION_KEYS.length > 150);
  assert.ok(EDIT_OPERATION_KEYS.includes("segment.split"));
  assert.ok(EDIT_OPERATION_KEYS.includes("video.add"));
  assert.ok(EDIT_OPERATION_KEYS.includes("undoRedo.undo"));
  assert.ok(EDIT_OPERATION_KEYS.includes("draft.setCanvasSize"));
});

test("the addon initializes and reports itself admissible", { skip }, async () => {
  const editor = openNativeEditor();
  try {
    assert.equal(editor.meta.details.admissible, true);
    assert.ok(editor.meta.addonPath.endsWith("videoeditor_addon.node"));
  } finally {
    await editor.close();
  }
});

test("a native session is created for the draft kind", { skip }, async () => {
  const editor = openNativeEditor();
  try {
    const created = await editor.createSession("draft");
    assert.equal(created.kind, "draft");
    assert.match(created.sessionId, /^ve-session-\d+$/);
  } finally {
    await editor.close();
  }
});

test("a draft with real media loads and reports playback state", { skip }, async () => {
  const editor = openNativeEditor();
  try {
    await editor.createSession("draft");
    await editor.loadDraft(DRAFT);
    const state = await editor.getState();
    assert.equal(state.status, "ready");
    assert.equal(state.durationUs, 3_000_000);
    assert.equal(state.frameWidth, 640);
    assert.equal(state.frameHeight, 360);
  } finally {
    await editor.close();
  }
});

test("the native edit domain mutates the real draft", { skip }, async () => {
  const editor = openNativeEditor();
  try {
    await editor.createSession("draft");
    await editor.loadDraft(DRAFT);
    const result = await editor.edit("segment.split", {
      segment_id: "33333333333333333333333333333333",
    });
    assert.equal(result.accepted, true);
    assert.equal(result.actionKey, "segment.split");
    assert.ok(result.diff.operations.length > 0);
  } finally {
    await editor.close();
  }
});

test("video.add decodes the media and extends the timeline", { skip }, async () => {
  const editor = openNativeEditor();
  try {
    await editor.createSession("draft");
    await editor.loadDraft(DRAFT);
    await editor.edit("video.add", {
      path: MEDIA,
      sourceDuration: 3_000_000,
      sourceStartTime: 0,
      startTime: 3_000_000,
      trackIndex: 0,
    });
    const draft = await editor.readDraft();
    assert.equal(draft.materials.videos.length, 2);
    assert.equal(draft.duration, 6_000_000);
    const added = draft.materials.videos.at(-1);
    assert.equal(added.width, 640);
    assert.equal(added.height, 360);
  } finally {
    await editor.close();
  }
});

test("a missing required parameter is rejected with a typed native code", { skip }, async () => {
  const editor = openNativeEditor();
  try {
    await editor.createSession("draft");
    await editor.loadDraft(DRAFT);
    await assert.rejects(
      () => editor.edit("segment.setTimeRange", {}),
      (cause) => cause instanceof NativeError && cause.code === "segment_id_required",
    );
  } finally {
    await editor.close();
  }
});

test("an operation outside the catalogue is refused before the native call", { skip }, async () => {
  const editor = openNativeEditor();
  try {
    await assert.rejects(
      () => editor.edit("segment.notAnOperation", {}),
      (cause) => cause.code === "unsupported_operation",
    );
  } finally {
    await editor.close();
  }
});
