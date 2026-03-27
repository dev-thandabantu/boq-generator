# BOQ Generator

AI-powered Bill of Quantities generator for construction projects in Southern Africa (Zambian context). Upload a Scope of Work PDF or rate an existing BOQ Excel, pay once, and receive a structured BOQ you can edit and export.

## Features

- PDF and DOCX upload and extraction
- AI-generated BOQ creation
- AI rate filling for existing Excel BOQs
- Stripe checkout
- Google OAuth auth with Supabase
- Browser-based BOQ editor
- Excel export and patched-original export
- Dashboard for saved BOQs
- Health check endpoint

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Auth + DB | Supabase |
| AI | Google Gemini 2.5 Pro / 2.5 Flash |
| Payments | Stripe Checkout |
| Deployment | Vercel |
| Styling | Tailwind CSS |
| Analytics | PostHog |
| Error tracking | Sentry |
| Rate limiting | Upstash Redis |

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd boq-generator
npm install
```

### 2. Environment variables

Copy `.env.local.example` to `.env.local` and fill in every value.

This repo is set up for three scopes:

- Development and Vercel Preview share the same non-production credentials.
- Production uses its own Supabase project, Stripe keys, bucket, and app URL.
- Shared service keys can stay the same across all environments if you want the simplest setup.

Core variables used by the app:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
DATABASE_DIRECT_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
DATABASE_POOLER_URL=postgresql://postgres.<project>:<password>@<pooler-host>:5432/postgres
SUPABASE_STORAGE_BUCKET=boq-generator-dev

# Stripe
STRIPE_SECRET_KEY=sk_live_...          # or sk_test_... for local dev / preview
STRIPE_WEBHOOK_SECRET=whsec_...        # from Stripe dashboard -> Webhooks

# Gemini
GEMINI_API_KEY=<your-google-ai-key>

# Resend
RESEND_API_KEY=<your-resend-key>

# App URL (no trailing slash)
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app   # or http://localhost:3000 locally

# PostHog analytics
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

# Sentry
SENTRY_DSN=https://...@....ingest.sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=<same value as SENTRY_DSN>

# Upstash Redis (optional in local dev)
UPSTASH_REDIS_REST_URL=https://<name>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
```

Local dev note: Upstash vars are optional. Rate limiting skips when they are absent. Sentry and PostHog server events are suppressed when `NODE_ENV !== "production"`.

### 2.1 Vercel environment matrix

Set the following in `Vercel -> Settings -> Environment Variables`:

| Variable | Development | Preview | Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | preview/dev value | preview/dev value | production value |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | preview/dev value | preview/dev value | production value |
| `SUPABASE_SERVICE_ROLE_KEY` | preview/dev value | preview/dev value | production value |
| `DATABASE_URL` | preview/dev value | preview/dev value | production value |
| `DATABASE_DIRECT_URL` | preview/dev value | preview/dev value | production value |
| `DATABASE_POOLER_URL` | preview/dev value | preview/dev value | production value |
| `SUPABASE_STORAGE_BUCKET` | shared preview/dev bucket | shared preview/dev bucket | production bucket |
| `STRIPE_SECRET_KEY` | test key | test key | live key |
| `STRIPE_WEBHOOK_SECRET` | local Stripe CLI secret | preview Stripe test secret | production Stripe webhook secret |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | preview deployment URL | production domain |
| `GEMINI_API_KEY` | shared value | shared value | shared value or production-only |
| `RESEND_API_KEY` | shared value | shared value | shared value or production-only |
| `NEXT_PUBLIC_POSTHOG_KEY` | shared value | shared value | shared value or production-only |
| `NEXT_PUBLIC_POSTHOG_HOST` | shared value | shared value | shared value |
| `SENTRY_DSN` | shared value | shared value | shared value or production-only |
| `NEXT_PUBLIC_SENTRY_DSN` | shared value | shared value | shared value or production-only |
| `UPSTASH_REDIS_REST_URL` | shared value | shared value | shared value or production-only |
| `UPSTASH_REDIS_REST_TOKEN` | shared value | shared value | shared value or production-only |

Recommended grouping:

- Shared by Development and Preview: all preview Supabase vars, `SUPABASE_STORAGE_BUCKET`, Stripe test vars, and non-production app URLs
- Production only: all production Supabase vars, production bucket name, Stripe live vars, and production app URL
- Safe to share everywhere for now: Gemini, Resend, PostHog, Sentry, and Upstash

### 3. Database migrations

Migrations live in `supabase/migrations/`.

- Production: GitHub Actions can run them on deploy
- Local dev: they can run at cold start via `instrumentation.ts` -> `lib/db/migrate.ts`

Manual example:

```bash
psql "$DATABASE_URL" -f supabase/migrations/001_initial.sql
psql "$DATABASE_URL" -f supabase/migrations/002_excel_rate_ingestion.sql
psql "$DATABASE_URL" -f supabase/migrations/003_indexes.sql
```

### 4. Configure Supabase Auth

In your Supabase project:

- Enable Google auth
- Add your Google OAuth client ID and secret
- Add `https://<your-app>.vercel.app/auth/callback` as an authorized redirect URI
- Set Site URL to your app URL
- Add the callback URL to Redirect URLs

### 5. Local development

```bash
npm run dev
```

Open `http://localhost:3000`.

For local Stripe testing:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use the printed `whsec_...` value as `STRIPE_WEBHOOK_SECRET` in `.env.local`.

## Deploying to Vercel

1. Push to GitHub and import the repo in Vercel.
2. Add all environment variables in `Settings -> Environment Variables`.
3. Set `NEXT_PUBLIC_APP_URL` to the correct URL for each environment.
4. Deploy.

### Recommended branch workflow

Use a stable long-lived branch for QA instead of trying to bind one custom domain to every PR branch.

- `master` -> Production -> `boq.aakitech.com`
- `qa` -> QA / pre-production -> `boq-generator-qa.aakitech.com`
- feature branches / PR branches -> normal Vercel preview URLs only

Recommended release flow:

1. Open a PR from your feature branch into `qa`
2. Test the change on `boq-generator-qa.aakitech.com`
3. Merge the PR into `qa`
4. GitHub Actions automatically fast-forwards `master` to match `qa`
5. Vercel deploys `master` to production

### QA domain setup in Vercel

If you want `boq-generator-qa.aakitech.com` to always show the latest QA build, connect it to a dedicated branch.

In Vercel:

1. Go to `Project -> Settings -> Domains`
2. Add `boq-generator-qa.aakitech.com`
3. Choose `Connect to an environment`
4. Select `Preview`
5. In the branch selector, choose the long-lived `qa` branch
6. Save

Important:

- Do not use `All Branches` for this use case
- Vercel needs a stable branch to keep one custom QA domain updated automatically
- Each PR branch will still get its own Vercel preview URL, but the fixed QA domain should follow the `qa` branch only

### QA environment variables

Because this repo uses shared non-production credentials:

- `Development` and `Preview` should keep using the same non-production Supabase and Stripe test values
- The `qa` branch will automatically use the Preview environment values in Vercel
- Set `NEXT_PUBLIC_APP_URL` for Preview to `https://boq-generator-qa.aakitech.com` if QA should use that custom domain consistently

### Automatic promotion from `qa` to `master`

This repo includes a GitHub Actions workflow at `.github/workflows/promote-qa-to-master.yml`.

What it does:

- Runs every time code is pushed to `qa`
- Verifies that `master` is behind `qa` instead of diverged
- Fast-forwards `master` to the exact same commit as `qa`
- Lets Vercel deploy `master` as Production automatically

Important GitHub setup:

1. Create the `qa` branch in GitHub
2. In GitHub, keep `master` protected with pull requests if you want review on direct feature work
3. Allow GitHub Actions to update `master`, or the workflow push will be blocked by branch protection

If your branch protection blocks the default `GITHUB_TOKEN`, you will need one of these:

- enable GitHub Actions to bypass protection for `master`
- or use a repository secret with a PAT that has permission to push to `master`

Important workflow rule:

- feature branches should open PRs into `qa`, not `master`
- `qa` remains a Preview deployment in Vercel
- `master` remains the Production branch in Vercel

### Stripe webhook

1. In Stripe, add a webhook endpoint.
2. Use `https://<your-app>.vercel.app/api/webhooks/stripe`.
3. Subscribe to `checkout.session.completed`.
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

### Storage bucket

The app uses `SUPABASE_STORAGE_BUCKET` for uploaded Excel files.

Recommended names:

- Development + Preview: `boq-generator-dev`
- Production: `boq-generator-prod`

Create the bucket in Supabase Storage with private access.

## Project structure

```text
app/
  upload/page.tsx
  dashboard/page.tsx
  login/page.tsx
  api/
  auth/callback/

lib/
  config.ts
  supabase/
  stripe.ts
  analytics.ts
  db/

supabase/
  migrations/
```

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Tables do not exist | Migrations have not run | Run the SQL files or check the migration workflow |
| Auth redirect loop | Supabase redirect URLs are wrong | Add `/auth/callback` in Supabase Auth settings |
| Stripe checkout fails | `STRIPE_SECRET_KEY` is missing | Add the correct key in Vercel |
| BOQ generation fails | `GEMINI_API_KEY` is missing or invalid | Add a valid Gemini key |
| Sentry not receiving events | DSN is missing | Add `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` |
