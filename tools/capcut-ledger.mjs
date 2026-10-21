/**
 * Build REA reconstruction obligation ledgers for the locally installed
 * CapCut desktop application from per-record Evidence files produced by
 * tools/extract-bundle-records.mjs.
 *
 * Each JavaScript application Evidence record is analyzed on its own: REA
 * canonicalizes a whole bundle into one JSON string, and a single CapCut
 * application graph already approaches the engine string limit, so a combined
 * multi-record bundle cannot be canonicalized in one process.
 *
 * Usage:
 *   node tools/capcut-ledger.mjs <recordsDir> <outputDir>
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createEvidenceBundle } from "../dist/domain/evidenceBundle.js";
import { buildReconstructionObligationLedgerEvidenceValidated } from "../dist/application/ReconstructionObligationLedgerService.js";

const [recordsDir, outputDir] = process.argv.slice(2);
if (!recordsDir || !outputDir) {
  console.error("Usage: node tools/capcut-ledger.mjs <recordsDir> <outputDir>");
  process.exit(2);
}

const CANDIDATE_OPERATIONS = new Set([
  "analyze_javascript_application",
  "reconcile_javascript_runtime",
  "project_managed_application_graph",
]);

await mkdir(outputDir, { recursive: true });

const files = (await readdir(recordsDir)).filter((name) => name.endsWith(".json"));
const candidates = [];
const skippedOperations = new Set();
for (const name of files) {
  const record = JSON.parse(await readFile(path.join(recordsDir, name), "utf8"));
  if (!CANDIDATE_OPERATIONS.has(record.operation)) {
    skippedOperations.add(record.operation);
    continue;
  }
  candidates.push({ name, record });
}

if (candidates.length === 0) {
  console.error("No candidate-producing Evidence records were found.");
  process.exit(1);
}

const ledgers = [];
for (const { name, record } of candidates) {
  const result = buildReconstructionObligationLedgerEvidenceValidated({
    evidence_bundle: createEvidenceBundle([record], []),
    reviewed_obligations: [],
    manifest: { bindings: [], contradictions: [] },
  });
  if (!result.ok) {
    ledgers.push({
      evidence_id: record.evidence_id,
      subject: record.subject?.name ?? null,
      status: "error",
      error: result.error,
    });
    continue;
  }
  const ledger = result.value.normalized_result;
  const filePath = path.join(outputDir, `${name.replace(/\.json$/, "")}.ledger.json`);
  await writeFile(
    filePath,
    JSON.stringify({ evidence: result.value, ledger }, null, 2),
    "utf8",
  );
  ledgers.push({
    evidence_id: record.evidence_id,
    subject: record.subject?.name ?? null,
    subject_path: record.subject?.local_path ?? null,
    output: filePath,
    ledger_id: ledger.ledger_id,
    closure_digest: ledger.closure_digest,
    status: ledger.status,
    coverage: ledger.coverage,
    summary: ledger.summary,
    by_status: ledger.by_status,
    by_application_layer: ledger.by_application_layer,
    by_source_state: ledger.by_source_state,
    limitation_count: (ledger.limitations ?? []).length,
  });
}

const indexPath = path.join(outputDir, "index.json");
await writeFile(indexPath, JSON.stringify({ ledgers, skippedOperations: [...skippedOperations] }, null, 2), "utf8");

console.log(
  JSON.stringify(
    {
      index: indexPath,
      analyzed: ledgers.length,
      skipped_operations: [...skippedOperations],
      ledgers: ledgers.map((ledger) => ({
        subject: ledger.subject,
        status: ledger.status,
        summary: ledger.summary,
      })),
    },
    null,
    2,
  ),
);
