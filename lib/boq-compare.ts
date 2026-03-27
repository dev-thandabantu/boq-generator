import type { BOQComparisonMatchedItem, BOQComparisonReport, BOQDocument, BOQItem } from "./types";

type ComparableItem = {
  key: string;
  label: string;
  item: BOQItem;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemKey(item: BOQItem): string {
  const explicit = normalizeText(item.item_key);
  if (explicit && !explicit.startsWith("sheet") && !explicit.includes(" row ")) return explicit;

  const itemNo = normalizeText(item.item_no);
  const description = normalizeText(item.description);
  const unit = normalizeText(item.unit);

  if (itemNo && description) return `${itemNo}::${description}`;
  if (description && unit) return `${description}::${unit}`;
  return description || itemNo || unit;
}

function toComparableItems(boq: BOQDocument): ComparableItem[] {
  return boq.bills.flatMap((bill) =>
    bill.items
      .filter((item) => !item.is_header)
      .map((item) => ({
        key: itemKey(item),
        label: item.description || item.item_no || "Unnamed item",
        item,
      }))
      .filter((entry) => entry.key)
  );
}

function sectionKeys(boq: BOQDocument): string[] {
  return boq.bills
    .map((bill) => normalizeText(bill.title))
    .filter(Boolean);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

export function compareBOQs(
  baseline: BOQDocument,
  candidate: BOQDocument,
  labels?: { baseline?: string; candidate?: string }
): BOQComparisonReport {
  const baselineItems = toComparableItems(baseline);
  const candidateItems = toComparableItems(candidate);
  const candidateMap = new Map(candidateItems.map((entry) => [entry.key, entry]));
  const baselineSections = sectionKeys(baseline);
  const candidateSections = sectionKeys(candidate);
  const baselineSectionSet = new Set(baselineSections);
  const candidateSectionSet = new Set(candidateSections);

  const matches: BOQComparisonMatchedItem[] = [];
  for (const baselineEntry of baselineItems) {
    const candidateEntry = candidateMap.get(baselineEntry.key);
    if (!candidateEntry) continue;

    const baselineRate = baselineEntry.item.rate;
    const candidateRate = candidateEntry.item.rate;
    if (baselineRate === null || candidateRate === null) continue;

    const absoluteDelta = Math.abs(candidateRate - baselineRate);
    const percentDelta = baselineRate === 0 ? null : (absoluteDelta / baselineRate) * 100;

    matches.push({
      key: baselineEntry.key,
      label: baselineEntry.label,
      baseline_rate: baselineRate,
      candidate_rate: candidateRate,
      absolute_delta: round(absoluteDelta) ?? 0,
      percent_delta: round(percentDelta),
      within_10pct: percentDelta !== null && percentDelta <= 10,
      within_20pct: percentDelta !== null && percentDelta <= 20,
    });
  }

  const baselinePricedItems = baselineItems.filter((entry) => entry.item.rate !== null).length;
  const candidatePricedItems = candidateItems.filter((entry) => entry.item.rate !== null).length;
  const comparablePricedItems = matches.length;
  const matchedItems = baselineItems.filter((entry) => candidateMap.has(entry.key)).length;
  const percentDeltas = matches
    .map((match) => match.percent_delta)
    .filter((value): value is number => value !== null);
  const signedDeltas = matches.map((match) => match.candidate_rate - match.baseline_rate);
  const coverageRatio = baselinePricedItems === 0 ? 0 : comparablePricedItems / baselinePricedItems;
  const within10 = comparablePricedItems === 0 ? 0 : matches.filter((match) => match.within_10pct).length / comparablePricedItems;
  const within20 = comparablePricedItems === 0 ? 0 : matches.filter((match) => match.within_20pct).length / comparablePricedItems;
  const mape =
    percentDeltas.length === 0 ? null : percentDeltas.reduce((sum, value) => sum + value, 0) / percentDeltas.length;
  const meanDelta =
    signedDeltas.length === 0 ? null : signedDeltas.reduce((sum, value) => sum + value, 0) / signedDeltas.length;
  const matchedSections = baselineSections.filter((section) => candidateSectionSet.has(section)).length;
  const sectionMatchRatio = baselineSections.length === 0 ? 0 : matchedSections / baselineSections.length;
  const itemMatchRatio = baselineItems.length === 0 ? 0 : matchedItems / baselineItems.length;
  const pricingAccuracyScore = round((within20 * 10)) ?? 0;
  const workbookBaseline = baseline.workbook_preservation;
  const workbookCandidate = candidate.workbook_preservation;
  let workbookFidelityScore = 0;
  if (workbookBaseline && workbookCandidate) {
    const rowScore = workbookBaseline.source_row_count === 0
      ? 0
      : Math.max(
          0,
          1 - Math.abs(workbookCandidate.source_row_count - workbookBaseline.source_row_count) / workbookBaseline.source_row_count
        );
    const mappedScore = workbookBaseline.mapped_item_rows === 0
      ? 0
      : Math.min(1, workbookCandidate.mapped_item_rows / workbookBaseline.mapped_item_rows);
    workbookFidelityScore = round((((rowScore * 0.4) + (mappedScore * 0.6)) * 10)) ?? 0;
  } else {
    workbookFidelityScore = round(((sectionMatchRatio * 0.5) + (itemMatchRatio * 0.5)) * 10) ?? 0;
  }
  const overallScore = round((((sectionMatchRatio * 0.3) + (itemMatchRatio * 0.3) + ((within20 || 0) * 0.4)) * 10)) ?? 0;
  const baselineItemLabels = new Map(baselineItems.map((entry) => [entry.key, entry.label]));
  const candidateItemLabels = new Map(candidateItems.map((entry) => [entry.key, entry.label]));
  const missingSections = baselineSections.filter((section) => !candidateSectionSet.has(section)).slice(0, 20);
  const extraSections = candidateSections.filter((section) => !baselineSectionSet.has(section)).slice(0, 20);
  const missingItemLabels = baselineItems
    .filter((entry) => !candidateMap.has(entry.key))
    .map((entry) => baselineItemLabels.get(entry.key) ?? entry.label)
    .slice(0, 25);
  const baselineItemSet = new Set(baselineItems.map((entry) => entry.key));
  const extraItemLabels = candidateItems
    .filter((entry) => !baselineItemSet.has(entry.key))
    .map((entry) => candidateItemLabels.get(entry.key) ?? entry.label)
    .slice(0, 25);

  return {
    baseline_label: labels?.baseline || baseline.project || "Baseline BOQ",
    candidate_label: labels?.candidate || candidate.project || "Candidate BOQ",
    baseline_total_items: baselineItems.length,
    candidate_total_items: candidateItems.length,
    matched_items: matchedItems,
    baseline_priced_items: baselinePricedItems,
    candidate_priced_items: candidatePricedItems,
    comparable_priced_items: comparablePricedItems,
    coverage_ratio: round(coverageRatio * 100) ?? 0,
    within_10pct_ratio: round(within10 * 100) ?? 0,
    within_20pct_ratio: round(within20 * 100) ?? 0,
    mean_absolute_percentage_error: round(mape),
    mean_rate_delta: round(meanDelta),
    median_rate_delta: round(median(signedDeltas)),
    section_match_ratio: round(sectionMatchRatio * 100) ?? 0,
    item_match_ratio: round(itemMatchRatio * 100) ?? 0,
    workbook_fidelity_score: workbookFidelityScore,
    pricing_accuracy_score: pricingAccuracyScore,
    overall_score: overallScore,
    missing_sections: missingSections,
    extra_sections: extraSections,
    missing_item_labels: missingItemLabels,
    extra_item_labels: extraItemLabels,
    sample_matches: matches
      .sort((a, b) => a.absolute_delta - b.absolute_delta)
      .slice(0, 15),
  };
}
