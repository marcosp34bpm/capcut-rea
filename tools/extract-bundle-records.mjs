/**
 * Extract Evidence records from a large REA Evidence bundle without loading the
 * whole document into one JavaScript string.
 *
 * The bundle is canonical RFC 8785 JSON produced by REA. This scanner reads
 * the byte stream, finds the top-level "records" array, and writes each of its
 * elements to its own JSON file. Only one record is held in memory at a time.
 *
 * Usage:
 *   node tools/extract-bundle-records.mjs <bundle.json> <outputDir>
 */
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";

const [bundlePath, outputDir] = process.argv.slice(2);
if (!bundlePath || !outputDir) {
  console.error(
    "Usage: node tools/extract-bundle-records.mjs <bundle.json> <outputDir>",
  );
  process.exit(2);
}

await mkdir(outputDir, { recursive: true });

const decoder = new StringDecoder("utf8");
const RECORDS_KEY = '"records":';

let phase = "search";
let searchBuffer = "";
let inString = false;
let escaped = false;
let depth = 0;
let inRecord = false;
let parts = [];
let segmentStart = 0;
let index = 0;
let written = 0;

const completeRecord = async () => {
  const text = "{" + parts.join("") + "}";
  const filePath = path.join(
    outputDir,
    `${String(index).padStart(3, "0")}.json`,
  );
  index += 1;
  written += 1;
  await writeFile(filePath, text, "utf8");
  parts = [];
};

const consume = async (text) => {
  let position = 0;
  if (phase === "search") {
    searchBuffer += text;
    const keyIndex = searchBuffer.indexOf(RECORDS_KEY);
    if (keyIndex < 0) {
      if (searchBuffer.length > 4096) searchBuffer = searchBuffer.slice(-64);
      return;
    }
    const bracketIndex = searchBuffer.indexOf("[", keyIndex);
    if (bracketIndex < 0) {
      searchBuffer = searchBuffer.slice(keyIndex);
      return;
    }
    text = searchBuffer.slice(bracketIndex + 1);
    searchBuffer = "";
    phase = "records";
    position = 0;
  }
  for (; position < text.length; position += 1) {
    const char = text[position];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (!inRecord) {
        inRecord = true;
        depth = 1;
        parts = [];
        segmentStart = position + 1;
        continue;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        parts.push(text.slice(segmentStart, position));
        await completeRecord();
        inRecord = false;
        continue;
      }
      continue;
    }
    if (char === "]" && !inRecord && depth === 0) {
      phase = "done";
      return;
    }
  }
  if (inRecord) {
    parts.push(text.slice(segmentStart));
    segmentStart = 0;
  }
};

for await (const chunk of createReadStream(bundlePath, { highWaterMark: 1 << 20 })) {
  await consume(decoder.write(chunk));
  if (phase === "done") break;
}

if (written === 0) {
  console.error("No top-level records array was located.");
  process.exit(1);
}
console.log(JSON.stringify({ count: written, outputDir }, null, 2));
