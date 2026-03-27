import type { BOQRateReference, BOQRateReferenceAssessment } from "./types";

const PACKAGED_RATE_REFERENCE_ASSESSMENTS: BOQRateReferenceAssessment[] = [
  {
    source_name: "ZPPA RATES.pdf",
    source_path: "inspo_docs/ZPPA RATES.pdf",
    relevance: "not_relevant",
    reason:
      "Packaged document content is a medical and laboratory product price index, not a construction schedule of rates.",
    effective_for: ["other"],
  },
];

export function getPackagedRateReferenceAssessments(): BOQRateReferenceAssessment[] {
  return PACKAGED_RATE_REFERENCE_ASSESSMENTS;
}

export function buildDefaultRateReference(): BOQRateReference {
  return {
    pricing_basis: "Embedded Zambian construction market rate guide used by the rating prompt",
    currency: "ZMW",
    version: "q1-2026-embedded-construction-rates",
    assessed_sources: getPackagedRateReferenceAssessments(),
  };
}
