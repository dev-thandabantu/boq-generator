import type { BOQDocument, BOQItem } from "./types";

// ─── Generate BOQ Tiers (by ZMW grand total) ──────────────────────────────────

export interface PricingTier {
  label: string;
  minZmw: number;
  maxZmw: number | null; // null = unbounded
  usdCents: number;
  displayUsd: string;
}

export const DEFAULT_TIERS: PricingTier[] = [
  { label: "Starter", minZmw: 0,           maxZmw: 100_000,    usdCents: 2000,  displayUsd: "$20"  },
  { label: "Small",   minZmw: 100_000,      maxZmw: 1_000_000,  usdCents: 5000,  displayUsd: "$50"  },
  { label: "Medium",  minZmw: 1_000_000,    maxZmw: 10_000_000, usdCents: 10000, displayUsd: "$100" },
  { label: "Large",   minZmw: 10_000_000,   maxZmw: 50_000_000, usdCents: 20000, displayUsd: "$200" },
  { label: "Major",   minZmw: 50_000_000,   maxZmw: null,       usdCents: 50000, displayUsd: "$500" },
];

// ─── Rate BOQ Tiers (by item count — no rates to sum at ingest time) ──────────

export interface RateBOQTier {
  label: string;
  maxItems: number | null; // null = unbounded
  usdCents: number;
  displayUsd: string;
}

export const DEFAULT_RATE_TIERS: RateBOQTier[] = [
  { label: "Small",  maxItems: 50,   usdCents: 3000,  displayUsd: "$30"  },
  { label: "Medium", maxItems: 150,  usdCents: 6000,  displayUsd: "$60"  },
  { label: "Large",  maxItems: 500,  usdCents: 8000,  displayUsd: "$80"  },
  { label: "Major",  maxItems: null, usdCents: 20000, displayUsd: "$200" },
];

// ─── Pricing result returned to the frontend ──────────────────────────────────

export interface PricingResult {
  grandTotalZmw: number;
  tier: PricingTier;
  billCount: number;
  itemCount: number;
  /** Tier range label (e.g. "ZMW 1M – 10M") — deliberately hides the exact total */
  approxRangeLabel: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeItemAmount(item: BOQItem): number | null {
  if (item.amount != null) return item.amount;
  if (item.qty != null && item.rate != null) return item.qty * item.rate;
  return null;
}

/** Mirrors the client-side grandTotal() logic in the dashboard. */
export function computeGrandTotalZmw(boq: BOQDocument): number {
  let total = 0;
  for (const bill of boq.bills ?? []) {
    for (const item of bill.items ?? []) {
      if (item.is_header) continue;
      const amt = computeItemAmount(item);
      if (amt != null) total += amt;
    }
  }
  return total;
}

/** Load generate-BOQ tiers from env, falling back to defaults. Server-side only. */
export function loadTiers(): PricingTier[] {
  try {
    const raw = process.env.PRICING_TIERS_JSON;
    if (raw) return JSON.parse(raw) as PricingTier[];
  } catch {
    // fall through
  }
  return DEFAULT_TIERS;
}

/** Load rate-BOQ tiers from env, falling back to defaults. Server-side only. */
export function loadRateTiers(): RateBOQTier[] {
  try {
    const raw = process.env.RATE_BOQ_TIERS_JSON;
    if (raw) return JSON.parse(raw) as RateBOQTier[];
  } catch {
    // fall through
  }
  return DEFAULT_RATE_TIERS;
}

export function getTierForAmount(zmw: number, tiers: PricingTier[] = DEFAULT_TIERS): PricingTier {
  for (const tier of tiers) {
    if (tier.maxZmw === null || zmw < tier.maxZmw) return tier;
  }
  return tiers[tiers.length - 1];
}

export function getTierForItemCount(itemCount: number, tiers: RateBOQTier[] = DEFAULT_RATE_TIERS): RateBOQTier {
  for (const tier of tiers) {
    if (tier.maxItems === null || itemCount <= tier.maxItems) return tier;
  }
  return tiers[tiers.length - 1];
}

function formatZmw(zmw: number): string {
  if (zmw >= 1_000_000) return `ZMW ${(zmw / 1_000_000).toFixed(0)}M`;
  if (zmw >= 1_000) return `ZMW ${(zmw / 1_000).toFixed(0)}K`;
  return `ZMW ${zmw.toFixed(0)}`;
}

export function computePricing(boq: BOQDocument, tiers?: PricingTier[]): PricingResult {
  const activeTiers = tiers ?? loadTiers();
  const grandTotalZmw = computeGrandTotalZmw(boq);
  const tier = getTierForAmount(grandTotalZmw, activeTiers);

  const billCount = (boq.bills ?? []).length;
  const itemCount = (boq.bills ?? [])
    .flatMap((b) => b.items ?? [])
    .filter((i) => !i.is_header)
    .length;

  const minLabel = formatZmw(tier.minZmw);
  const maxLabel = tier.maxZmw !== null ? formatZmw(tier.maxZmw) : null;
  const approxRangeLabel = maxLabel ? `${minLabel} – ${maxLabel}` : `> ${minLabel}`;

  return { grandTotalZmw, tier, billCount, itemCount, approxRangeLabel };
}
