# Changelog

All notable changes to this project are documented here.

## [Unreleased] - 2026-03-28

### Added
- Vitest + @testing-library/react test framework bootstrap. 12 tests covering all pricing tier boundaries.

### Changed
- Rate BOQ pricing tiers updated: Small $30 (≤50 items), Medium $60 (≤150), Large $80 (≤500), Major $200 (501+). Adds Major tier to handle large BOQs (1500+ rows).
- Zero-rate gate: uploading a BOQ where all rates are already filled now returns a clear error before any storage or DB writes occur. Error message includes guidance to use the Generate tab instead.
- Stale `$20` fallback in upload UI updated to `$30` to match new minimum pricing tier.

### Fixed
- Dead code removed from `RateBOQTab.handleValidate()` — the "all rates filled" UI guard was unreachable (API returns 400 before success path). "Try the Generate tab" guidance moved into the API error message so users actually see it.

## [0.1.0] - Initial release

- BOQ generation from scope-of-work documents
- Rate filling for uploaded Excel BOQs
- Stripe payment integration
- Supabase auth and storage
