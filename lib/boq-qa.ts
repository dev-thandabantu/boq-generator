import type { BOQDocument, BOQItem, BOQQualityScore } from "./types";

const NON_BOQ_SEMANTIC_PATTERNS = [
  /\bquestionnaire\b/i,
  /\bsurvey\b/i,
  /\bfeedback\b/i,
  /\brespondent\b/i,
  /\buser story\b/i,
  /\bacceptance criteria\b/i,
  /\bsuccess criteria\b/i,
  /\bopen questions?\b/i,
  /\bassumptions?\b/i,
  /\bdependencies\b/i,
  /\bmigration strategy\b/i,
  /\brollout plan\b/i,
  /\bdashboard\b/i,
  /\badmin ui\b/i,
  /\bworkflow\b/i,
  /\bschema\b/i,
  /\bapi\b/i,
  /\blyrics\b/i,
  /\bchorus\b/i,
  /\bverse\b/i,
];

function looksLikeNonBOQItem(description: string): boolean {
  return NON_BOQ_SEMANTIC_PATTERNS.some((pattern) => pattern.test(description));
}

function nonHeaderItems(boq: BOQDocument): BOQItem[] {
  return boq.bills.flatMap((bill) => bill.items.filter((item) => !item.is_header));
}

function clampScore(value: number): number {
  if (value < 1) return 1;
  if (value > 10) return 10;
  return Math.round(value * 10) / 10;
}

export function gradeFromScore(score: number): BOQQualityScore["grade"] {
  if (score >= 8.5) return "Strong";
  if (score >= 7) return "Good";
  if (score >= 5) return "Fair";
  return "Weak";
}

export function computeDeterministicQA(boq: BOQDocument): BOQQualityScore {
  const items = nonHeaderItems(boq);
  const totalItems = items.length;
  const billCount = boq.bills.length;
  const measuredItems = items.filter((item) => item.qty !== null).length;
  const pricedItems = items.filter((item) => item.rate !== null).length;
  const invalidFieldValues = items.filter(
    (item) =>
      (item.rate !== null && typeof item.rate !== "number") ||
      (item.amount !== null && typeof item.amount !== "number")
  ).length;
  const missingQty = items.filter((item) => item.qty == null).length;
  const lowConfidence = items.filter((item) => (item.quantity_confidence ?? 0.4) < 0.6).length;
  const evidenceBacked = items.filter(
    (item) => item.qty !== null && (item.source_excerpt?.trim().length ?? 0) >= 12
  ).length;
  const supportingDocUsage = items.filter(
    (item) => item.source_document && item.source_document !== "primary-1"
  ).length;
  const shortDescriptions = items.filter((item) => item.description.trim().length < 12).length;
  const itemUnitRows = items.filter((item) => item.unit === "Item" || item.unit === "LS").length;
  const nonBOQSemanticItems = items.filter((item) => looksLikeNonBOQItem(item.description)).length;
  const hasPreliminaries = boq.bills.some((bill) => bill.title.toUpperCase().includes("PRELIM"));
  const sourceBundleStatus = boq.quality_summary?.source_bundle_status ?? boq.document_classification?.source_bundle_status;
  const missingRequiredAttachments =
    boq.quality_summary?.missing_required_attachments ??
    boq.document_classification?.required_attachments.length ??
    0;

  const flags: string[] = [];

  if (!hasPreliminaries) flags.push("Missing a preliminaries bill.");
  if (billCount < 3) flags.push("Very few bills for a construction BOQ.");
  if (invalidFieldValues > 0) flags.push(`${invalidFieldValues} rows have invalid non-numeric rate or amount fields.`);
  if (totalItems < 15) flags.push("Low line-item coverage; BOQ may be too summarized.");
  if (missingQty > 0) flags.push(`${missingQty} line items still have unresolved quantities.`);
  if (lowConfidence > 0) flags.push(`${lowConfidence} items have low quantity confidence.`);
  if (measuredItems > 0 && evidenceBacked < measuredItems) {
    flags.push(`${measuredItems - evidenceBacked} measured items are missing source evidence.`);
  }
  if (supportingDocUsage > 0) {
    flags.push(`${supportingDocUsage} items are using supporting-document evidence.`);
  }
  if (shortDescriptions > 0) flags.push(`${shortDescriptions} descriptions are too short or vague.`);
  if (totalItems > 0 && itemUnitRows / totalItems > 0.55) {
    flags.push("Too many items use broad Item/LS units instead of measurable units.");
  }
  if (nonBOQSemanticItems > 0) {
    flags.push(`${nonBOQSemanticItems} items read like software/spec sections instead of BOQ work items.`);
  }
  if (sourceBundleStatus === "missing_required_attachments") {
    flags.push("BOQ quality is limited because the source scope references required attachments that were not provided.");
  }

  let score = 8.8;
  if (!hasPreliminaries) score -= 1.2;
  if (billCount < 3) score -= 1.1;
  if (invalidFieldValues > 0) score -= Math.min(2, invalidFieldValues * 0.4);
  if (totalItems < 15) score -= 2.2;
  if (totalItems < 30) score -= 1.1;
  if (missingQty > 0) score -= Math.min(2.2, missingQty * 0.12);
  if (lowConfidence > 0) score -= Math.min(1.6, lowConfidence * 0.08);
  if (measuredItems > 0 && evidenceBacked < measuredItems) {
    score -= Math.min(1.8, (measuredItems - evidenceBacked) * 0.15);
  }
  if (supportingDocUsage > 0) score += Math.min(0.8, supportingDocUsage * 0.08);
  if (shortDescriptions > 0) score -= Math.min(1.2, shortDescriptions * 0.1);
  if (totalItems > 0 && itemUnitRows / totalItems > 0.55) score -= 1.1;
  if (nonBOQSemanticItems > 0) score -= Math.min(4.2, 1.4 + nonBOQSemanticItems * 0.28);
  if (pricedItems > 0 && pricedItems / Math.max(totalItems, 1) > 0.9) score -= 0.4;
  if (sourceBundleStatus === "missing_required_attachments") score -= 2.2;

  const finalScore = clampScore(score);
  const grade = gradeFromScore(finalScore);
  const subscores = {
    coverage: clampScore(
      10 -
        (billCount < 3 ? 2 : 0) -
        (totalItems < 15 ? 4 : totalItems < 30 ? 2 : 0) -
        (itemUnitRows / Math.max(totalItems, 1) > 0.55 ? 1 : 0)
    ),
    source_completeness: clampScore(
      10 -
        (sourceBundleStatus === "missing_required_attachments" ? 5 : 0) -
        Math.min(3, missingRequiredAttachments * 1.2)
    ),
    field_integrity: clampScore(
      10 -
        Math.min(5, invalidFieldValues * 1.3) -
        Math.min(4, missingQty * 0.18) -
        Math.min(2.5, lowConfidence * 0.1)
    ),
    evidence_traceability: clampScore(
      10 -
        (measuredItems > 0
          ? Math.min(5, (measuredItems - evidenceBacked) * 0.25)
          : 3) +
        Math.min(2, supportingDocUsage * 0.2)
    ),
    boq_semantics: clampScore(
      10 -
        Math.min(6, nonBOQSemanticItems * 0.35) -
        Math.min(2, shortDescriptions * 0.08)
    ),
  };

  const summary =
    grade === "Strong"
      ? "Well-structured BOQ with strong coverage and quantity traceability."
      : grade === "Good"
      ? "Usable BOQ with a few quality gaps worth reviewing before issue."
      : grade === "Fair"
      ? "BOQ is partially usable, but quantity coverage and specificity need work."
      : "BOQ quality is weak; it needs significant review before relying on it.";

  return {
    score: finalScore,
    grade,
    summary,
    flags,
    subscores,
    source: "deterministic",
    updated_at: new Date().toISOString(),
  };
}

export function mergeQAScores(
  deterministic: BOQQualityScore,
  llm: Pick<BOQQualityScore, "score" | "grade" | "summary" | "flags" | "subscores">
): BOQQualityScore {
  const mergedScore = clampScore(deterministic.score * 0.65 + llm.score * 0.35);
  const mergedFlags = Array.from(new Set([...deterministic.flags, ...llm.flags])).slice(0, 8);
  const mergedSubscores = {
    coverage: clampScore(
      ((deterministic.subscores?.coverage ?? deterministic.score) * 0.75) +
        ((llm.subscores?.coverage ?? llm.score) * 0.25)
    ),
    source_completeness: clampScore(
      ((deterministic.subscores?.source_completeness ?? deterministic.score) * 0.75) +
        ((llm.subscores?.source_completeness ?? llm.score) * 0.25)
    ),
    field_integrity: clampScore(
      ((deterministic.subscores?.field_integrity ?? deterministic.score) * 0.75) +
        ((llm.subscores?.field_integrity ?? llm.score) * 0.25)
    ),
    evidence_traceability: clampScore(
      ((deterministic.subscores?.evidence_traceability ?? deterministic.score) * 0.75) +
        ((llm.subscores?.evidence_traceability ?? llm.score) * 0.25)
    ),
    boq_semantics: clampScore(
      ((deterministic.subscores?.boq_semantics ?? deterministic.score) * 0.75) +
        ((llm.subscores?.boq_semantics ?? llm.score) * 0.25)
    ),
  };

  return {
    score: mergedScore,
    grade: gradeFromScore(mergedScore),
    summary: llm.summary || deterministic.summary,
    flags: mergedFlags,
    subscores: mergedSubscores,
    source: "hybrid",
    updated_at: new Date().toISOString(),
  };
}
