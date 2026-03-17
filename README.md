# BOQ Generator

AI-powered Bill of Quantities generator for construction projects in Southern Africa (Zambian context). Upload a Scope of Work PDF, pay once, and receive a fully structured, editable BOQ you can export to Excel.

## Features

- **PDF upload & text extraction** — drag-and-drop a Scope of Work document
- **AI-generated BOQ** — Gemini 2.5 Flash extracts line items, quantities, units, and groups them into standard trade bills
- **Stripe payment gate** — $100 per generation; no account needed to pay
- **Google OAuth auth** — sign in to save and revisit past BOQs
- **BOQ editor** — edit rates in-browser; amounts auto-calculate; changes auto-save to the database
- **Excel export** — download a formatted `.xlsx` file ready for tendering
- **Dashboard** — view and reopen all previously generated BOQs

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Auth + DB | Supabase (Postgres + Row Level Security) |
| AI | Google Gemini 2.5 Flash |
| Payments | Stripe Checkout |
| Deployment | Vercel |
| Styling | Tailwind CSS |
| Excel | ExcelJS |

## User Flow

```
Upload PDF → Pay $100 (Stripe) → /generating (AI processing) → BOQ Editor → Export Excel
                                                                     ↓
                                                              Saved to Supabase
                                                                     ↓
                                                           Accessible from Dashboard
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
```

### 3. Run database migrations

The schema is in `supabase/migrations/001_initial.sql`. Run it **once** in your Supabase project:

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**
2. Paste the full contents of `supabase/migrations/001_initial.sql`
3. Click **Run**

This creates the `profiles`, `boqs`, and `payments` tables with Row Level Security policies. The SQL is idempotent — safe to re-run.

> **Why manual?** Vercel serverless functions can't reliably run DDL migrations at cold-start. Running the SQL directly in Supabase is the most reliable approach.

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
2. Add all environment variables from `.env.local` to Vercel → **Settings → Environment Variables**
3. Set `NEXT_PUBLIC_APP_URL` to your actual Vercel URL (e.g. `https://boq-generator-ten.vercel.app`)
4. Deploy
5. **Run the SQL migration** in Supabase (Step 3 above) — required before the app can store any data

### Stripe webhook (production)

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://<your-app>.vercel.app/api/webhooks/stripe`
3. Events to listen for: `checkout.session.completed`
4. Copy the signing secret (`whsec_...`) into Vercel env as `STRIPE_WEBHOOK_SECRET`

---

## Project structure

```
app/
  page.tsx              # Upload / pricing page
  login/page.tsx        # Google sign-in
  generating/page.tsx   # Progress screen while AI runs
  boq/[id]/page.tsx     # BOQ editor (loads from DB)
  dashboard/page.tsx    # List of past BOQs
  auth/callback/        # Supabase OAuth callback handler
  api/
    extract/            # PDF → text extraction
    checkout/           # Create Stripe Checkout session
    generate/           # Gemini BOQ generation + save to DB
    boqs/               # GET list, GET by id, PUT (auto-save), AI edit assistant (stream + preview)
    export/             # Excel export
    webhooks/stripe/    # Stripe payment confirmation

lib/
  claude.ts             # Gemini API wrapper (generateBOQ)
  boq-assistant.ts      # Gemini wrapper for BOQ-only edit instructions
  db/                   # Supabase client helpers + migrate.ts
  stripe.ts             # Lazy Stripe client
  types.ts              # Shared TypeScript types

supabase/
  migrations/
    001_initial.sql     # Full schema (profiles, boqs, payments)
```

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `Internal Server Error` on any page | Tables don't exist in Supabase | Run `001_initial.sql` in Supabase SQL Editor |
| Auth redirect loop | Supabase redirect URLs not configured | Add `/auth/callback` URL in Supabase Auth settings |
| Stripe checkout fails | `STRIPE_SECRET_KEY` is a placeholder | Add real key in Vercel env vars |
| BOQ generation fails | `GEMINI_API_KEY` is missing or invalid | Add real Gemini API key in Vercel env vars |
| `NEXT_PUBLIC_APP_URL` mismatch | Wrong app URL set | Update to exact Vercel deployment URL |
