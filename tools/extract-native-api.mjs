/**
 * Extract the native video-editor method inventory from REA search_strings
 * Evidence for videoeditor_addon.node.
 *
 * The Evidence record is the one produced by
 * `search_strings` with the method-name regular expression.
 *
 * Usage:
 *   node tools/extract-native-api.mjs <record.json> <output.md>
 */
import { readFile, writeFile } from "node:fs/promises";

const [recordPath, outputPath] = process.argv.slice(2);
if (!recordPath || !outputPath) {
  console.error("Usage: node tools/extract-native-api.mjs <record.json> <output.md>");
  process.exit(2);
}

const record = JSON.parse(await readFile(recordPath, "utf8"));
if (record.operation !== "search_strings") {
  console.error(`Unexpected operation: ${record.operation}`);
  process.exit(1);
}

const entries = record.normalized_result ?? [];
const names = [...new Set(entries.map((entry) => entry.value))].sort((left, right) =>
  left.localeCompare(right),
);

const GROUPS = [
  ["Track and timeline", /^(arrange|setMain|moveMain|moveSub|moveTrack|setTrack|renderIndex|muteAll|muteToAll|inspectMain|matchCaption|setFixClash|setIsOnlyOne)/],
  ["Segment editing", /^(add|remove|split|merge|move|update|replace|copy)(Video|Audio|Text|Sticker|Segment|Combination|Group|Beat|Timemark|Material)/],
  ["Text and caption", /^(add|update|remove|delete|replace|merge|split|set|get|move|apply|query|create)(Text|Caption|Subtitle|Keyword|CoverText|Font|CharIndex|Cursor|RichStr|PlainStr|Rtl)/],
  ["Effect, filter and adjustment", /^(add|remove|update|replace|set|get|apply|preview)(VideoEffect|Filter|GlobalFilter|GlobalVideoEffect|GlobalAdjust|PictureAdjust|Beauty|Reshape|Stretch|Chroma|Hdr|Figure|Sticker|ObjectLocked)/],
  ["AI and generative features", /(Ai|AI|Chat|GenAi|DigitalHuman|Lyric|AITranslate|AIGC|SmartMotion|SmartCrop|SmartMatch|AgentExport)/],
  ["Material and asset", /^(add|update|remove|replace|get|query|load|save|export|import)(Material|Attachment|AttachmentNodes|Resource|OnlineResource|AvFile|MediaInfo|DraftStatic)/],
  ["Audio", /^(add|remove|update|replace|get|set|copy|apply)(Audio|RecordingAudio|TextAudio|Music|Vocal|Voice|Loudness|Pcm|Sample)/],
  ["Canvas and cover", /^(set|get|update|add|remove|save|crop|renderIndex)(Canvas|Cover|CoverText|CoverSegment|RetouchCover)/],
  ["Sticker and tracking", /^(add|update|remove|replace|get|set|find|copy)(Sticker|Tracking|Tracker|VideoTracking|SmartMask)/],
  ["Keyframes and animation", /(Keyframe|KeyFrame|Animation|Anim)/],
  ["Render and export", /^(render|export|save|prerender|getRenderFileList|setPrerender|usePrerender)/],
  ["History and undo", /^(add|get|remove|set)(History|OnceDraftUpdate|BeforeAction|BeforeDriver)/],
  ["Template and cover preset", /^(add|remove|update|apply|copy|save|delete)(Template|Combination|TemplateSegment|UnevenTemplate|BreakUpTemplate|SubTemplate)/],
  ["Playback and preview", /^(preview|setPreview|getPreview|setState|setRate|setVolume|setMuted|setLoop|setOffscreen)/],
  ["Task and async lifecycle", /^(create|get|update|setup|remove)(AsyncTask|AsyncTasks|Task)/],
];

const grouped = new Map(GROUPS.map(([label]) => [label, []]));
const ungrouped = [];
for (const name of names) {
  const group = GROUPS.find(([, pattern]) => pattern.test(name));
  if (group === undefined) ungrouped.push(name);
  else grouped.get(group[0]).push(name);
}

const lines = [];
lines.push("# CapCut native video-editor method inventory");
lines.push("");
lines.push(`- Source artifact: \`videoeditor_addon.node\``);
lines.push(`- Artifact SHA-256: \`${record.subject.digest.sha256}\``);
lines.push(`- Architecture: ${record.subject.architecture}`);
lines.push(`- Provider: ${record.provider.name} ${record.provider.version ?? ""}`.trim());
lines.push(`- Evidence ID: \`${record.evidence_id}\``);
lines.push(`- Total distinct method-like strings: ${names.length}`);
lines.push("");
lines.push(
  "These are static string observations in the shipped artifact. They name the",
  "exported native surface; they do not prove runtime behavior or call order.",
  "",
);
for (const [label, values] of grouped) {
  if (values.length === 0) continue;
  lines.push(`## ${label} (${values.length})`);
  lines.push("");
  lines.push(values.map((value) => `- \`${value}\``).join("\n"));
  lines.push("");
}
if (ungrouped.length > 0) {
  lines.push(`## Other observed names (${ungrouped.length})`);
  lines.push("");
  lines.push(ungrouped.map((value) => `- \`${value}\``).join("\n"));
  lines.push("");
}
lines.push("## Limitations");
lines.push("");
for (const limitation of record.limitations ?? []) lines.push(`- ${limitation}`);
lines.push("");

await writeFile(outputPath, lines.join("\n"), "utf8");
console.log(
  JSON.stringify(
    { output: outputPath, names: names.length, groups: grouped.size, ungrouped: ungrouped.length },
    null,
    2,
  ),
);
