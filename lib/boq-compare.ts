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
  if (explicit) return explicit;

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

  return {
    baseline_label: labels?.baseline || baseline.project || "Baseline BOQ",
    candidate_label: labels?.candidate || candidate.project || "Candidate BOQ",
    baseline_total_items: baselineItems.length,
    candidate_total_items: candidateItems.length,
    matched_items: baselineItems.filter((entry) => candidateMap.has(entry.key)).length,
    baseline_priced_items: baselinePricedItems,
    candidate_priced_items: candidatePricedItems,
    comparable_priced_items: comparablePricedItems,
    coverage_ratio: round(coverageRatio * 100) ?? 0,
    within_10pct_ratio: round(within10 * 100) ?? 0,
    within_20pct_ratio: round(within20 * 100) ?? 0,
    mean_absolute_percentage_error: round(mape),
    mean_rate_delta: round(meanDelta),
    median_rate_delta: round(median(signedDeltas)),
    sample_matches: matches
      .sort((a, b) => a.absolute_delta - b.absolute_delta)
      .slice(0, 15),
  };
}
