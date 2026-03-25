# BOQ Generator

AI-powered Bill of Quantities generator for construction projects in Southern Africa (Zambian context). Upload a Scope of Work PDF or rate an existing BOQ Excel — pay once and receive a fully structured, editable BOQ you can export to Excel.

## Features

- **PDF/DOCX upload & extraction** — drag-and-drop a Scope of Work document
- **AI-generated BOQ** — Gemini 2.5 Pro extracts line items, quantities, units, and groups them into standard trade bills
- **Rate an existing BOQ** — upload an unrated Excel BOQ; AI fills in Zambian market rates calibrated to province, site accessibility, labour source, and margin
- **Rate-source traceability** — rated BOQs now record the pricing basis used, plus packaged reference documents that were assessed and excluded
- **BOQ comparison API** — compare an AI-rated BOQ against a human-priced BOQ to track coverage and pricing accuracy
- **Stripe payment gate** — $100 per generation or rating; no account needed to pay
- **Google OAuth auth** — sign in to save and revisit past BOQs
- **BOQ editor** — edit rates in-browser; amounts auto-calculate; changes auto-save
- **AI edit assistant** — natural-language instructions to add/remove/edit BOQ items via streaming assistant
- **Excel export** — download a formatted `.xlsx` in Zambian tender format, or patch your original Excel file with rates added in-place
- **Dashboard** — view and reopen all previously generated BOQs
- **Health check** — `GET /api/health` returns DB connectivity status (for uptime monitors)

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Auth + DB | Supabase (Postgres + Row Level Security) |
| AI | Google Gemini 2.5 Pro (primary) / 2.5 Flash (fallback) |
| Payments | Stripe Checkout |
| Deployment | Vercel |
| Styling | Tailwind CSS |
| Excel | xlsx (SheetJS) |
| Error tracking | Sentry (`@sentry/nextjs`) |
| Analytics | PostHog (client + server-side events) |
| Rate limiting | Upstash Redis (`@upstash/ratelimit`) |

## User Flows

```
── Generate from SoW ──────────────────────────────────────────────────────────
Upload PDF/DOCX → Extract text → Pay $100 (Stripe) → /generating (AI) → BOQ Editor → Export Excel
                                                                              ↓
                                                                       Saved to Supabase

── Rate an existing BOQ ───────────────────────────────────────────────────────
Upload Excel BOQ → Validate structure → Answer 5 context questions → Pay $100 (Stripe)
  → /generating (AI fills rates) → BOQ Editor → Export patched Excel or formatted BOQ
```

---

## Setup

### 1. Clone & install

```bash
git clone <repo-url>
cd boq-generator
npm install
```

### 2. Environment variables

Copy `.env.local.example` to `.env.local` and fill in every value:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Direct Postgres connection (for migrations)
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres

# Stripe
STRIPE_SECRET_KEY=sk_live_...          # or sk_test_... for local dev
STRIPE_WEBHOOK_SECRET=whsec_...        # from Stripe dashboard → Webhooks

# Gemini
GEMINI_API_KEY=<your-google-ai-key>

# App URL (no trailing slash)
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app   # or http://localhost:3000 locally

# Supabase Storage bucket for uploaded Excel files
SUPABASE_STORAGE_BUCKET=boq-generator-dev

# PostHog analytics
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

# Sentry error tracking
SENTRY_DSN=https://...@....ingest.sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=<same value as SENTRY_DSN>

# Upstash Redis (rate limiting — optional in local dev, required in production)
UPSTASH_REDIS_REST_URL=https://<name>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
```

> **Local dev:** Upstash vars are optional — rate limiting gracefully skips when they are absent. Sentry and PostHog server events are suppressed when `NODE_ENV !== "production"`.

### 3. Database migrations

Migrations live in `supabase/migrations/` and run automatically:

- **Production** — a GitHub Actions workflow (`.github/workflows/migrate.yml`) runs all `*.sql` files in sorted order on every push to `master`.
- **Local dev** — migrations run at Next.js cold-start via `instrumentation.ts` → `lib/db/migrate.ts`.

If you need to run them manually:

```bash
psql "$DATABASE_URL" -f supabase/migrations/001_initial.sql
psql "$DATABASE_URL" -f supabase/migrations/002_excel_rate_ingestion.sql
psql "$DATABASE_URL" -f supabase/migrations/003_indexes.sql
```

### 4. Configure Supabase Auth

In your Supabase project → **Authentication → Providers**:

- Enable **Google**
- Add your Google OAuth Client ID and Secret (from [Google Cloud Console](https://console.cloud.google.com/))
- Add your app's callback URL as an **Authorized redirect URI** in Google:
  ```
  https://<your-app>.vercel.app/auth/callback
  ```
- In Supabase → **Authentication → URL Configuration**, set:
  - **Site URL**: `https://<your-app>.vercel.app`
  - **Redirect URLs**: `https://<your-app>.vercel.app/auth/callback`

### 5. Local development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For local Stripe testing, install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and forward webhooks:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The CLI will print a `whsec_...` secret — use that as `STRIPE_WEBHOOK_SECRET` in `.env.local`.

---

## Deploying to Vercel

1. Push to GitHub and import the repo in [Vercel](https://vercel.com/new)
2. Add all environment variables to Vercel → **Settings → Environment Variables**
3. Set `NEXT_PUBLIC_APP_URL` to your actual Vercel URL
4. Deploy — migrations run automatically on first cold-start

### Stripe webhook (production)

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://<your-app>.vercel.app/api/webhooks/stripe`
3. Events to listen for: `checkout.session.completed`
4. Copy the signing secret (`whsec_...`) into Vercel env as `STRIPE_WEBHOOK_SECRET`

### Storage bucket

The app uses `SUPABASE_STORAGE_BUCKET` (default: `boq-generator-dev`) to store uploaded Excel files before rate filling. Create that bucket in Supabase → **Storage** with private access (RLS handled by the service role key).

---

## Project structure

```
app/
  page.tsx                  # Landing page
  upload/page.tsx           # Upload / pricing page (Generate + Rate tabs)
  login/page.tsx            # Google sign-in
  generating/page.tsx       # Progress screen while AI runs
  boq/[id]/page.tsx         # BOQ editor (loads from DB)
  dashboard/page.tsx        # List of past BOQs
  error.tsx                 # App-level error boundary (reports to Sentry)
  not-found.tsx             # Styled 404 page
  global-error.tsx          # Root HTML error boundary
  auth/callback/            # Supabase OAuth callback handler
  api/
    extract/                # PDF/DOCX → text extraction + SOW detection
    checkout/               # Create Stripe Checkout session
    generate/               # Gemini BOQ generation + save to DB
    rate-boq/               # Gemini rate filling for uploaded Excel BOQs
    compare-boqs/           # Compare baseline vs candidate BOQ pricing accuracy
    ingest-boq/             # Validate + upload Excel BOQ to Storage
    boqs/                   # GET list, GET by id, PUT (auto-save)
    boqs/[id]/assistant/    # AI edit assistant (streaming + preview modes)
    export/                 # Excel export (formatted or patched original)
    health/                 # GET /api/health — DB connectivity check
    webhooks/stripe/        # Stripe payment confirmation

lib/
  claude.ts                 # Gemini API wrapper (generateBOQ, fillBOQRates)
  boq-assistant.ts          # Gemini wrapper for BOQ edit instructions
  excel.ts                  # Excel parsing, CSV conversion, patchExcelWithRates
  logger.ts                 # Zero-dependency structured JSON logger
  analytics.ts              # PostHog server-side event tracking (production only)
  config.ts                 # Startup env var validation
  db/                       # Supabase client helpers + migrate.ts
  stripe.ts                 # Lazy Stripe client
  types.ts                  # Shared TypeScript types

supabase/
  migrations/
    001_initial.sql         # Schema: profiles, boqs, payments + RLS
    002_excel_rate_ingestion.sql  # source_excel_key, rate/amount col headers
    003_indexes.sql         # Performance indexes

proxy.ts                    # Next.js middleware: auth guard + IP rate limiting
instrumentation.ts          # Server init: Sentry + DB migrations
instrumentation-client.ts   # Browser Sentry init + Session Replay
sentry.server.config.ts     # Node runtime Sentry config
sentry.edge.config.ts       # Edge runtime Sentry config
```

## Observability

| Tool | What it covers |
|---|---|
| **Sentry** | Unhandled server errors, React error boundaries, edge errors, Session Replay |
| **PostHog** | `boq_generated`, `boq_rated`, `excel_ingested`, `payment_completed` server events + client-side page views |
| **Structured logs** | All API routes emit JSON logs (`lib/logger.ts`) — visible in Vercel log drain |

## Notes on Zambian Rate References

- The current BOQ rating flow uses an embedded Zambian construction rate guide in `lib/claude.ts`.
- The packaged file [inspo_docs/ZPPA RATES.pdf](/Users/mohara/Documents/aakitech/Saas/BOQ/boq-generator/inspo_docs/ZPPA%20RATES.pdf) is not a construction schedule of rates; it appears to be a medical/product price index, so it should not be used to price construction BOQs.
- Rated BOQ outputs now carry `rate_reference` metadata so you can see which pricing basis was used and which packaged sources were excluded.
| **Health check** | `GET /api/health` — returns `{ status, timestamp, db }` for uptime monitors |
| **Rate limiting** | Upstash Redis sliding window: 10 requests / 15 min per IP on AI routes |

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Tables don't exist | Migration hasn't run | Check GitHub Actions → migrate job, or run SQL files manually |
| Auth redirect loop | Supabase redirect URLs not configured | Add `/auth/callback` to Supabase Auth settings |
| Stripe checkout fails | `STRIPE_SECRET_KEY` is missing | Add real key in Vercel env vars |
| BOQ generation fails | `GEMINI_API_KEY` missing or invalid | Add real Gemini API key in Vercel env vars |
| Rate filling misaligns | Excel BOQ has unusual structure | Check that the rate column header is detected correctly in the `/api/ingest-boq` response |
| 429 on AI routes | Upstash rate limit hit | Wait 15 minutes, or increase limit in `proxy.ts` |
| Sentry not receiving | DSN not set in Vercel | Add `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` to Vercel env vars |
