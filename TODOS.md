# TODOS

## Rate BOQ Feature

### P1 — Rate Memory (deferred from CEO review 2026-03-28)
When 10+ paid BOQs exist, extract a rate lookup table from `boqs.data` where `payment_status = 'paid'`. Fuzzy-match item descriptions to pre-fill rates before AI inference. Compounding moat.
**Deferred from plan:** `~/.gstack/projects/dev-thandabantu-boq-generator/ceo-plans/2026-03-28-boq-rate-filling.md`

### P2 — PostHog `rate_edited` event (deferred from CEO review 2026-03-28)
When a user edits a rate post-fill in the BOQ editor, emit `{ boq_id, item_description, ai_rate, new_rate, province, bill_name }`. Implement alongside rate memory — the data feeds the feedback loop.
**Deferred from plan:** same as above

### P2 — % of BOQ value pricing v2 (deferred from CEO review 2026-03-28)
Innocent's proposed model: base fee by item count + % of total value. Requires a Zambian benchmark rate table per trade category. Re-evaluate when 20+ paid rate BOQs exist.
**Deferred from plan:** same as above

## Testing

### P2 — API integration test: zero-rate gate
`POST /api/ingest-boq` with a fully-rated BOQ should return 400. Requires Next.js test server setup.

### P2 — Component test: RateBOQTab fallback display
Verify `rateAmountCents` initial render shows `$30` not `$20`.

## Completed

- Zero-rate gate in `ingest-boq` API — returns 400 before storage upload (v0.1.0, 2026-03-28)
- Rate BOQ pricing tiers: Small $30/Medium $60/Large $80/Major $200 (v0.1.0, 2026-03-28)
- Remove QA scoring UI from chat panel (v0.1.0, 2026-03-28)
