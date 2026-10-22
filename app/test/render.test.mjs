/**
 * Contract tests for the renderer.
 *
 * These render the real native draft with the FFmpeg binary shipped with the
 * local CapCut installation. They are skipped when CapCut is not installed.
 */

import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openNativeEditor } from "../src/native/editor.mjs";
import { openRemoteEditor } from "../src/native/client.mjs";
import {
  backgroundColor,
  canvasSize,
  durationOf,
  planRender,
  resolveFfmpeg,
  toSeconds,
  toTimestamp,
  trackSegments,
} from "../src/native/render.mjs";
import { renderDraft, decodeTextContent, textLayers } from "../src/native/render-draft.mjs";
import { drawText, encodePng, measureText, renderTextOverlay } from "../src/native/text-overlay.mjs";

const CAPCUT_ROOT =
  process.env.CAPCUT_ROOT ??
  "C:\\Users\\marco\\AppData\\Local\\CapCut\\Apps\\9.6.0.4097";
const DRAFT = "C:\\Users\\marco\\Documents\\capcut-rea\\app\\native\\draft_content.json";
const MEDIA = "C:/Users/marco/Documents/capcut-rea/app/native/media/clip.mp4";
const available =
  existsSync(resolveFfmpeg(CAPCUT_ROOT)) &&
  existsSync(DRAFT) &&
  existsSync(MEDIA.replace("/", "\\"));
const skip = available ? false : "the local CapCut installation is not present";

/**
 * Run one operation against the real engine.
 *
 * The engine runs in a host process, exactly as the shipped application runs
 * it. That keeps the native worker threads out of the test process and matches
 * the production path.
 *
 * @param {(editor: object) => Promise<unknown>} operation the operation
 * @returns {Promise<unknown>} the operation result
 */
const withEditor = async (operation) => {
  const editor = await openRemoteEditor({
    CAPCUT_ROOT,
    CAPCUT_DRAFT_PATH: DRAFT,
  });
  try {
    return await operation(editor);
  } finally {
    await editor.close();
  }
};

// The native engine runs in a host process, so the test process has no native
// worker threads to keep alive and the runner exits on its own.

test("timestamps convert to the FFmpeg forms", () => {
  assert.equal(toTimestamp(0), "00:00:00.000");
  assert.equal(toTimestamp(3_000_000), "00:00:03.000");
  assert.equal(toTimestamp(3_661_000), "00:00:03.661");
  assert.equal(toTimestamp(61_661_000), "00:01:01.661");
  assert.equal(toSeconds(3_000_000), "3.000");
});

test("the renderer resolves the shipped ffmpeg binary", () => {
  assert.ok(resolveFfmpeg(CAPCUT_ROOT).endsWith("ffmpeg.exe"));
  assert.ok(existsSync(resolveFfmpeg(CAPCUT_ROOT)));
});

test("the plan describes the canvas, the clips and the encoder", { skip }, async () => {
  await withEditor(async (editor) => {
    const draft = await editor.readDraft();
    const plan = planRender(draft, { output: join(tmpdir(), "plan-test.mp4") });
    assert.ok(plan.args.includes("h264_nvenc"));
    assert.ok(plan.args.includes("[vout]"));
    assert.ok(plan.args.some((argument) => String(argument).includes("trim=start=")));
    assert.ok(plan.args.some((argument) => String(argument).includes("overlay")));
    assert.deepEqual(plan.warnings, []);
  });
});

test("the plan reports media that is missing", () => {
  const draft = {
    canvas_config: { width: 640, height: 360 },
    fps: 30,
    duration: 1_000_000,
    tracks: [
      {
        id: "t1",
        type: "video",
        segments: [
          {
            id: "s1",
            material_id: "m1",
            source_timerange: { start: 0, duration: 1_000_000 },
            target_timerange: { start: 0, duration: 1_000_000 },
          },
        ],
      },
    ],
    materials: { videos: [{ id: "m1", path: "C:\\nowhere\\missing.mp4" }] },
  };
  const plan = planRender(draft, { output: join(tmpdir(), "plan-missing.mp4") });
  assert.equal(plan.warnings.length, 1);
  assert.ok(plan.warnings[0].includes("media not found"));
});

test("canvas, background and duration are read from the draft", () => {
  const draft = {
    canvas_config: { width: 1080, height: 1920, background: { color: "#112233" } },
    fps: 24,
    duration: 5_000_000,
    tracks: [],
  };
  assert.deepEqual(canvasSize(draft), { width: 1080, height: 1920 });
  assert.equal(backgroundColor(draft), "#112233");
  assert.equal(durationOf(draft), 5_000_000);
});

test("segments are ordered by their timeline position", () => {
  const track = {
    segments: [
      { id: "b", target_timerange: { start: 5_000_000 } },
      { id: "a", target_timerange: { start: 0 } },
    ],
  };
  assert.deepEqual(
    trackSegments(track).map((segment) => segment.id),
    ["a", "b"],
  );
});

test("the text rasterizer draws measurable ink", () => {
  const width = 200;
  const height = 40;
  const pixels = new Uint8Array(width * height * 4);
  const drawn = drawText(
    pixels,
    width,
    height,
    "Hi",
    2,
    2,
    2,
    [255, 255, 255, 255],
  );
  assert.ok(drawn > 0);
  assert.equal(measureText("Hi", 2), drawn);
  const inked = pixels.filter((_, index) => index % 4 === 3 && pixels[index] > 0);
  assert.ok(inked.length > 0);
});

test("the PNG encoder writes a valid signature and chunk", () => {
  const pixels = new Uint8Array(4 * 4 * 4).fill(200);
  const png = encodePng(pixels, 4, 4);
  assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.slice(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.slice(png.length - 8, png.length - 4).toString("ascii"), "IEND");
});

test("styled text content is decoded from the material", () => {
  assert.equal(
    decodeTextContent(JSON.stringify({ text: "Hello REA" })),
    "Hello REA",
  );
  assert.equal(decodeTextContent("plain"), "plain");
  assert.equal(decodeTextContent({ text: "obj" }), "obj");
});

test("the renderer produces a playable file", { skip }, async () => {
  const output = join(tmpdir(), `capcut-render-test-${Date.now()}.mp4`);
  const result = await withEditor(async (editor) => {
    await editor.edit("video.add", {
      path: MEDIA,
      sourceDuration: 3_000_000,
      sourceStartTime: 0,
      startTime: 3_000_000,
      trackIndex: 0,
    });
    const draft = await editor.readDraft();
    return renderDraft(draft, { capcutRoot: CAPCUT_ROOT, output });
  });
  assert.equal(result.ffmpeg.code, 0);
  assert.equal(result.encoder, "h264_nvenc");
  assert.equal(result.durationUs, 6_000_000);
  assert.ok(existsSync(output));
  assert.ok(statSync(output).size > 10_000);
});

test("a text layer is rasterized and overlaid", { skip }, async () => {
  const output = join(tmpdir(), `capcut-render-text-${Date.now()}.mp4`);
  const result = await withEditor(async (editor) => {
    await editor.edit("text.add", {
      content: "Hello REA",
      seg_info: {},
      time_range: { start: 0, duration: 3_000_000 },
    });
    const draft = await editor.readDraft();
    assert.equal(textLayers(draft).length, 1);
    return renderDraft(draft, { capcutRoot: CAPCUT_ROOT, output });
  });
  assert.equal(result.textLayers, 1);
  assert.ok(existsSync(result.output));
});


