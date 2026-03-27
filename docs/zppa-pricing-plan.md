# ZPPA Pricing Integration Plan

## Purpose

This document captures the intended approach for integrating ZPPA market price data into the BOQ rating/generation system in a future branch.

The goal is to make pricing more grounded in Zambian market reality without tightly coupling the product to one static PDF or one-off prompt behavior.

This is a planning document only. It is not the implementation.

## Product Goals

We want ZPPA integration to help with:

- grounding commodity/material rates in a Zambia-specific source
- improving consistency for first-pass BOQ pricing
- reducing catastrophic AI pricing errors on common items
- making rate provenance more transparent
- allowing updates when ZPPA rates change each quarter
- measuring whether ZPPA actually improves pricing quality before rolling it out broadly

We do **not** want to:

- blindly use the entire ZPPA document as a direct pricing engine
- overwrite workbook-local precedent when the uploaded BOQ already contains better project-specific signals
- hardcode quarterly rates into prompts only
- introduce a change process that is difficult to update or evaluate

## Working Assumptions

- The ZPPA document is a useful **reference source**, not a complete BOQ pricing engine.
- Only some sections are relevant to construction BOQs.
- ZPPA is likely most useful for:
  - materials
  - fittings/accessories
  - selected equipment/product items
  - calibration of market ranges
- ZPPA is less likely to be sufficient on its own for:
  - full installed composite rates
  - preliminaries
  - labour-heavy trade assemblies
  - contractor-specific pricing
  - overhead/profit-sensitive negotiated items

## Relevant Sections to Extract First

The first implementation should only target sections of `inspo_docs/ZPPA RATES.pdf` that are plausibly relevant to BOQs:

- Building and Construction Products
- Electrical Machinery, Equipment, Appliances, Fittings and Accessories
- Fire Suppression Equipment
- Vehicles, Heavy Duty Equipment and Machinery
- Borehole Drilling and Associated Works

Optional later:

- Furniture / fittings categories where they clearly appear in BOQs
- Security / surveillance equipment when present in scope

Do not ingest unrelated sections into the pricing engine by default.

## Proposed Architecture

### 1. Structured reference layer

Create a structured ZPPA reference dataset rather than pricing directly from the PDF at runtime.

Recommended shape:

- `source_name`
- `source_version`
- `effective_quarter`
- `currency`
- `category`
- `subcategory`
- `item_label`
- `normalized_item_label`
- `unit`
- `min_rate`
- `max_rate`
- `median_rate`
- `location_scope`
- `source_page`
- `notes`
- `active`

This should live in a form that can be updated quarterly without code edits to pricing logic.

Candidate storage options:

- Supabase table for active queryable rates
- versioned source files in the repo for dev/reference
- optional JSON snapshot committed under `docs/` or `data/` for auditability

### 2. Rate-source precedence

ZPPA should be one pricing input among several.

Preferred precedence for existing-BOQ rating:

1. existing workbook rate
2. workbook-local exact or near-duplicate precedent
3. project-consistency inference
4. ZPPA structured reference
5. generic AI market heuristic

Preferred precedence for SOW generation:

1. project-local benchmark data if available
2. ZPPA structured reference
3. generic AI market heuristic

### 3. Query strategy

When pricing an item:

- classify the BOQ row into a broad pricing category
- normalize description and unit
- attempt a lookup against structured ZPPA entries
- only use ZPPA where:
  - category is relevant
  - unit is compatible
  - label similarity clears a threshold
- use ZPPA as:
  - direct reference for commodity-like items
  - sanity band / outlier guard for AI-proposed rates
  - calibration signal in prompts, not just a hidden background source

### 4. Update workflow

The ZPPA layer should be designed for quarterly updates.

Recommended quarterly workflow:

1. add the new ZPPA source document
2. run an extraction/normalization job
3. review extracted rows
4. publish a new reference version
5. mark old version inactive but keep it for audit
6. run benchmark comparisons before switching production default

This update process should not require pricing-code rewrites.

## Suggested Implementation Phases

### Phase 1: Evaluation branch

Create a separate branch to test ZPPA usefulness without destabilizing the current BOQ rating branch.

Deliverables:

- small structured extraction from relevant ZPPA sections
- category mapping for a subset of BOQ items
- benchmark comparisons against existing human-priced BOQs
- report on improvement vs no-ZPPA baseline

### Phase 2: Narrow production integration

If Phase 1 shows value:

- use ZPPA for commodity/material categories only
- add provenance labels such as `external_reference_document`
- use ZPPA as an outlier guard and calibration layer first

### Phase 3: Broader integration

If narrow integration works:

- expand category coverage
- build quarterly refresh tooling
- integrate into both existing-BOQ rating and SOW pricing paths

## Measurement Plan

We should measure usefulness explicitly instead of assuming it.

Use benchmark BOQs already in `inspo_docs/`:

- Drip and Filter Station
- Nakambala Private School
- Pipeline / smaller civil BOQ
- People Vehicle Separation

Compare:

- baseline current pricing engine
- pricing engine with ZPPA-assisted grounding

Metrics:

- workbook fidelity score
- item coverage
- priced item coverage
- `% within 10%`
- `% within 20%`
- MAPE
- catastrophic outlier count
- number of rows intentionally left blank
- improvement by category:
  - concrete/commodity
  - pipe runs
  - fittings/accessories
  - electrical commodity items
  - fabricated/specialist rows

The rollout decision should be based on measured gains, not intuition.

## Risks

- Overtrusting ZPPA for composite installed rates
- Matching the wrong ZPPA entry to a BOQ item
- Using stale quarterly data
- Treating ZPPA as a universal source across irrelevant categories
- Inflating implementation complexity before proving value

## Recommended Guardrails

- keep ZPPA optional at runtime behind a feature flag in the evaluation branch
- use it first for bounded categories only
- store rate provenance for every ZPPA-assisted decision
- keep old and new ZPPA versions auditable
- do not let ZPPA override stronger workbook-local evidence

## Branch Recommendation

Do the ZPPA work in a separate branch after the current existing-BOQ fidelity/accuracy branch is stable.

Suggested branch purpose:

- `zppa-pricing-eval`

Suggested first success criterion:

- prove that structured ZPPA grounding improves pricing on commodity-like rows without harming workbook fidelity or increasing catastrophic mismatches

