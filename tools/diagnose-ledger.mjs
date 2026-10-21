/**
 * Diagnose why the CapCut reconstruction obligation ledger build fails.
 *
 * Usage:
 *   node tools/diagnose-ledger.mjs <recordsDir>
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  createEvidenceBundle,
  parseEvidenceBundle,
} from "../dist/domain/evidenceBundle.js";
import { parseApplicationGraphEvidence } from "../dist/application/javascript/JavaScriptApplicationEvidenceGraph.js";

const [recordsDir] = process.argv.slice(2);
const CANDIDATE_OPERATIONS = new Set([
  "analyze_javascript_application",
  "reconcile_javascript_runtime",
  "project_managed_application_graph",
]);

const files = (await readdir(recordsDir)).filter((name) => name.endsWith(".json"));
const records = [];
for (const name of files) {
  const record = JSON.parse(await readFile(path.join(recordsDir, name), "utf8"));
  if (CANDIDATE_OPERATIONS.has(record.operation)) records.push(record);
}
records.sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
console.log("candidate records:", records.length);

const {
  buildReconstructionObligationLedgerEvidenceValidated,
} = await import("../dist/application/ReconstructionObligationLedgerService.js");

for (const record of records) {
  const single = createEvidenceBundle([record], []);
  let state;
  try {
    const result = buildReconstructionObligationLedgerEvidenceValidated({
      evidence_bundle: single,
      reviewed_obligations: [],
      manifest: { bindings: [], contradictions: [] },
    });
    if (!result.ok) {
      state = `ledger FAIL: ${JSON.stringify(result.error).slice(0, 300)}`;
    } else {
      const ledger = result.value.result;
      state = `ledger OK ${JSON.stringify(ledger.summary)}`;
    }
  } catch (cause) {
    state = `THROW: ${cause.message.slice(0, 300)}`;
  }
  console.log(record.evidence_id.slice(0, 16), state);
}
