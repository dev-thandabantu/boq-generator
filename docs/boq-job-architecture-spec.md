# BOQ Generation and Rating Reliability Spec

## Summary

This app helps users do two high-value jobs:

1. Generate a Bill of Quantities from a Scope of Work and supporting documents.
2. Rate an existing Excel BOQ while preserving the original workbook structure.

Today, both flows can work, but they are not production-reliable because they still depend on long synchronous HTTP requests. The browser stays connected to `/generating` while the server performs AI work, workbook parsing, pricing, and persistence. That works sometimes, but fails often enough to create false error states, timeouts, and inconsistent user trust.

This spec proposes a job-based asynchronous architecture so that:

- the user experience no longer depends on one fragile long request
- BOQ work can continue after the browser disconnects
- progress and recovery become deterministic
- retries can happen safely without duplicate BOQs or duplicate charges

This document is intended to give the team shared context on:

- what the app needs to achieve
- why the current design is only partially reliable
- what the proposed production architecture is
- the implications, tradeoffs, and rollout plan

## Product Context

### What this app needs to achieve

The app is not just a document processor. It is a paid workflow product that needs to do all of the following reliably:

1. Accept user documents.
2. Extract enough structure to generate or rate a BOQ.
3. Run AI-assisted BOQ generation or rate filling.
4. Save the result durably.
5. Let the user reopen the BOQ later from the dashboard.
6. Support exports:
   - formatted house-style BOQ
   - patched original Excel for existing-BOQ rating
7. Recover cleanly if the browser refreshes, disconnects, or the page is closed.

### Core user-facing workflows

#### Workflow A: Generate BOQ from SOW

User uploads a primary Scope of Work and sometimes supporting documents. The system:

- validates the document bundle
- asks the AI to generate a BOQ structure
- computes a pricing tier
- takes payment
- unlocks the BOQ

#### Workflow B: Rate existing BOQ

User uploads an existing Excel BOQ. The system:

- reads the workbook deterministically
- preserves workbook structure
- asks the AI to fill missing rates
- saves the rated BOQ
- lets the user export the patched original workbook

For this workflow, the primary promise is preservation and recoverability, not one-shot generation.

## Current Architecture

### Current request flow

The app currently relies on synchronous route handlers.

Relevant routes today:

- `/api/generate`
- `/api/rate-boq`
- `/api/unlock-boq`
- `/api/ingest-boq`
- `/api/boqs/by-session`
- `/generating`

High-level behavior:

1. User uploads documents or a workbook.
2. The app creates a Stripe checkout session.
3. After payment, the frontend loads `/generating?session_id=...`.
4. The frontend calls either:
   - `/api/generate`
   - `/api/rate-boq`
   - or `/api/unlock-boq`
5. The page waits for that request to finish.
6. If it succeeds, the UI redirects to the saved BOQ.
7. If it fails or the connection drops, the UI tries to recover by looking up a BOQ by `stripe_session_id`.

### Why it works sometimes

This architecture works when all of the following happen:

- the AI call finishes quickly enough
- the workbook extraction/pricing completes within the route time limit
- the browser keeps the request alive
- the BOQ saves successfully before the client gives up
- the recovery lookup finds the saved BOQ soon enough

When those conditions all align, users get a good experience.

### Why it is not reliable

The current design is fragile because it ties business completion to one browser-visible request.

Failure patterns we already see:

1. Long-running AI requests
   - large SOWs or large Excel BOQs can take several minutes
   - retries, fallback models, or malformed JSON recovery make runtime worse

2. Browser/network disconnects
   - the backend can finish successfully
   - but the frontend still shows an error because the browser lost the request

3. Recovery timing race
   - the page may poll for a saved BOQ before the row is visible or fully written
   - this creates false “Something went wrong” states

4. Vercel/serverless execution limits
   - long synchronous route handlers are inherently fragile in serverless environments
   - even when the hard limit is not reached, user-visible request time becomes unacceptable

5. Save-path fragility
   - if preview rows or final save steps fail, the AI work may finish but not be durably attached to the user flow

6. Poor production semantics
   - the UI is acting like a job monitor
   - but the backend is acting like a one-shot request handler
   - those two mental models do not align

## Problem Statement

We need to make BOQ generation and BOQ rating production-reliable.

Production-reliable means:

- a BOQ job should continue even if the browser disconnects
- the user should be able to refresh and still recover the job
- payment should not trigger duplicate processing
- save state should be durable and inspectable
- retries should be safe and scoped
- the UI should reflect job state, not request state

The current architecture does not satisfy those requirements consistently.

## Proposed Architecture

### Core idea

Move BOQ processing from a synchronous request model to a durable asynchronous job model.

Instead of:

- browser calls one route
- server does all work inline
- browser waits and hopes it completes

we should do:

- browser starts or resumes a BOQ job
- backend processes the job asynchronously
- browser polls job status
- user is redirected only when job status is truly complete

### New architectural model

#### 1. Introduce a `boq_jobs` table

This table becomes the orchestration source of truth.

Suggested fields:

- `id`
- `user_id`
- `type`
  - `generate_boq`
  - `rate_boq`
- `stripe_session_id`
- `boq_id`
- `status`
  - `queued`
  - `processing`
  - `completed`
  - `failed`
  - `retryable`
- `stage`
  - `payment_verified`
  - `validating_input`
  - `extracting`
  - `generating`
  - `pricing`
  - `saving`
  - `completed`
- `progress_pct`
- `attempt_count`
- `last_error`
- `input_reference`
  - storage key or preview BOQ id
- `result_reference`
  - final BOQ id
- `created_at`
- `updated_at`

#### 2. Make jobs idempotent

Every paid session should map deterministically to one job.

Rules:

- if a job already exists for a `stripe_session_id`, return it
- if a BOQ is already completed for that job, return the existing BOQ id
- if a retry happens, resume the same job rather than creating a second BOQ

#### 3. Separate orchestration from processing

Suggested endpoints:

- `POST /api/boq-jobs/start`
  - validates payment/session context
  - creates or returns an existing job

- `GET /api/boq-jobs/[id]`
  - returns job status, stage, progress, errors, and `boq_id` if complete

- `POST /api/boq-jobs/process`
  - internal worker endpoint
  - advances one job or one job stage

The current `/generating` page should stop directly invoking long BOQ work and instead poll job state.

#### 4. Break work into resumable stages

##### For SOW generation

Stages:

1. payment/session verification
2. input validation
3. document extraction / truncation / prep
4. AI BOQ generation
5. preview save / final save
6. mark complete

##### For existing BOQ rating

Stages:

1. payment/session verification
2. storage download
3. workbook extraction
4. rate-fill batches
5. BOQ save
6. payment linkage
7. mark complete

Each stage should be safe to resume.

#### 5. Batch long AI work

This is especially important for existing-BOQ rating.

Instead of one large AI call:

- split unresolved items into batches
- process each batch independently
- save partial progress after each batch

This reduces:

- timeout risk
- malformed JSON blast radius
- all-or-nothing failure behavior

#### 6. Persist partial state

Jobs should be able to survive:

- browser close
- browser refresh
- route timeout
- transient AI failure

That means the system needs partial state persisted between steps, for example:

- extracted workbook BOQ snapshot
- unresolved item list
- completed batch indexes
- partial BOQ data

#### 7. Make `/generating` a job-status screen

The generating page should:

1. create or resume a job
2. poll job status
3. show current stage and progress
4. redirect when `status = completed`
5. show retry guidance only when the job is definitely failed

The UI should stop assuming “request failed” means “job failed.”

## Proposed Runtime Model

There are two viable ways to run the new architecture:

### Option A: Vercel-native jobs

Use:

- Vercel serverless routes
- Vercel Queues and/or Workflows
- database-backed job state

This is the lowest-ops option and fits the current deployment model.

### Option B: Dedicated worker

Use:

- web app remains on Vercel
- heavy BOQ processing runs on a dedicated worker service
  - Render
  - Railway
  - Fly.io
  - or another long-running worker host

This gives more execution control but adds operational overhead.

### Recommendation

Start with **Option A** if the team wants the fastest path with the fewest moving parts.

Move to **Option B** later if:

- job volume grows
- execution times remain high
- Vercel-native orchestration becomes too limiting

## Why this architecture solves the current problem

### It removes browser dependence

Today the browser is part of the critical path.

In the proposed design:

- browser starts the job
- backend owns completion
- browser only observes state

That is the correct production model.

### It makes errors recoverable

Today a dropped request creates user-visible ambiguity.

With jobs:

- a job is either queued, processing, completed, or failed
- the user can always refresh and resume the same state

### It makes retries safe

Today retries can duplicate work or race with an in-flight request.

With jobs:

- retries target one durable job id
- duplicate session handling becomes straightforward

### It reduces timeout pressure

Today one route tries to do too much.

With jobs:

- work can be chunked
- stages can be resumed
- slow steps do not have to complete inside one user request

## Pros and Cons

### Pros

1. Much more reliable production behavior
2. Better user trust
3. Safe refresh/retry semantics
4. Easier debugging because job state is explicit
5. Better fit for large BOQs
6. Easier to add progress reporting
7. Clearer separation between payment, processing, and viewing

### Cons

1. More backend complexity
2. Requires a new orchestration table and status model
3. Requires updating the generating page and route contracts
4. Requires job lifecycle monitoring
5. Some extra cost from more requests / queue usage / polling

## Implementation Implications

### Database changes

We need new schema for jobs.

At minimum:

- `boq_jobs` table
- indexes on:
  - `stripe_session_id`
  - `user_id`
  - `status`
  - `created_at`

Potentially:

- `boq_job_events` table for debugging
- or keep logs external and keep `boq_jobs` lean

### API changes

New endpoints:

- `POST /api/boq-jobs/start`
- `GET /api/boq-jobs/[id]`
- `POST /api/boq-jobs/process`

Existing endpoints may be simplified:

- `/api/generate`
- `/api/rate-boq`

These can eventually become internal job-processing functions or stage handlers instead of direct user-facing endpoints.

### Frontend changes

The generating screen should:

- accept a `job_id`
- poll job status
- show stage-specific progress
- support resume after reload
- remove the idea that the page itself performs the work

### Observability changes

We should log:

- job created
- job resumed
- stage started
- stage completed
- stage failed
- AI batch retry
- final completion

This will make production debugging significantly easier.

## Rollout Plan

### Phase 1: Add job model without changing core BOQ logic

Goal:

- keep existing generation/rating internals
- wrap them with job orchestration

Deliverables:

- `boq_jobs` schema
- start/status endpoints
- generating page polling

### Phase 2: Move existing-BOQ rating into staged execution

Goal:

- reduce timeout sensitivity for the highest-risk long-running workflow

Deliverables:

- workbook extraction stage
- rate-fill batching
- resumable save stage

### Phase 3: Move SOW generation into staged execution

Goal:

- give the SOW workflow the same reliability model

Deliverables:

- staged validation/extraction/generation/save flow

### Phase 4: Add stronger observability and operations tooling

Deliverables:

- internal job dashboard or admin filters
- job retry controls
- alerting on stuck jobs

## Non-Goals

This spec does not solve:

1. pricing accuracy quality by itself
2. ZPPA integration
3. house-style BOQ fidelity
4. AI prompt quality
5. chat editing design

Those are separate quality tracks.

This spec is specifically about **reliability, completion semantics, and recoverability**.

## Recommended First Reliable Path

The first reliable production option is:

1. keep current BOQ business logic largely intact
2. add durable async job orchestration
3. make `/generating` poll job status
4. batch long existing-BOQ rating work

This gives the highest production value with the least wasteful rework.

## Decision

Recommended direction:

- adopt a job-based asynchronous BOQ processing architecture
- use database-backed job state as the source of truth
- treat browser pages as observers of jobs, not owners of execution
- roll out existing-BOQ rating first, then SOW generation

This is the most direct way to stop the recurring class of “it finished or maybe it failed” production errors and make the app dependable enough for real paid usage.
