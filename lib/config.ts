/**
 * Validates that all required environment variables are present.
 * Called at module load time — throws immediately with a clear list if any are missing.
 */

const REQUIRED_SERVER_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_API_KEY",
  "NEXT_PUBLIC_APP_URL",
  "SUPABASE_STORAGE_BUCKET",
] as const;

const deploymentEnv = process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
const paymentProvider = (process.env.PAYMENT_PROVIDER ??
  "flutterwave") as "stripe" | "flutterwave";
const providerSpecificVars =
  paymentProvider === "flutterwave"
    ? (["FLUTTERWAVE_SECRET_KEY"] as const)
    : (["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const);

const missing = [...REQUIRED_SERVER_VARS, ...providerSpecificVars].filter((key) => !process.env[key]);

if (missing.length > 0 && process.env.NODE_ENV === "production") {
  throw new Error(
    `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join("\n")}\n\nAdd them to your Vercel project settings.`
  );
}

export const config = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  geminiApiKey: process.env.GEMINI_API_KEY!,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? null,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
  flutterwaveSecretKey: process.env.FLUTTERWAVE_SECRET_KEY ?? null,
  paymentProvider,
  appUrl: process.env.NEXT_PUBLIC_APP_URL!,
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET!,
  isProduction: process.env.NODE_ENV === "production",
} as const;
