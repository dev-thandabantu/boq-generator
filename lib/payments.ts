import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { trackEvent } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import type { PostgrestError } from "@supabase/supabase-js";

export type PaymentProvider = "stripe" | "flutterwave";

type PaymentType = "generate_boq" | "rate_boq";
type PaymentMetadata = Record<string, string>;

type CreateCheckoutInput = {
  reference: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  customerName?: string | null;
  metadata: PaymentMetadata;
  title: string;
  description: string;
  origin: string;
};

export type CreatedCheckout = {
  provider: PaymentProvider;
  reference: string;
  url: string;
};

export type VerifiedPayment = {
  provider: PaymentProvider;
  reference: string;
  processorReference: string | null;
  paid: boolean;
  amountCents: number;
  currency: string;
  metadata: PaymentMetadata;
  customerEmail: string | null;
};

export type ExpectedPayment = {
  provider: PaymentProvider;
  reference: string;
  processorReference: string | null;
  amountCents: number;
  currency: string;
  userId: string | null;
  boqId: string | null;
  status: string;
};

type PersistPaymentInput = {
  provider: PaymentProvider;
  reference: string;
  processorReference: string | null;
  userId: string | null;
  boqId: string | null;
  amountCents: number;
  currency: string;
  metadata: PaymentMetadata;
};

type FlutterwaveVerifyResponse = {
  status?: string;
  message?: string;
  data?: {
    id?: number | string;
    tx_ref?: string;
    flw_ref?: string;
    amount?: number | string;
    currency?: string;
    status?: string;
    customer?: {
      email?: string;
    };
    meta?: Record<string, unknown>;
  };
};

export function getActivePaymentProvider(): PaymentProvider {
  const forced = process.env.PAYMENT_PROVIDER?.toLowerCase();
  if (forced === "stripe" || forced === "flutterwave") {
    return forced;
  }
  return "flutterwave";
}

export function getFlutterwaveCurrency(): string {
  return (process.env.FLUTTERWAVE_CURRENCY ?? "USD").toUpperCase();
}

export function getPublicAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  }
  return configured;
}

export function createPaymentReference(type: PaymentType, boqId?: string | null): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  return `boq_${type}_${boqId ?? "adhoc"}_${suffix}`;
}

export async function createCheckoutSession(input: CreateCheckoutInput): Promise<CreatedCheckout> {
  const provider = getActivePaymentProvider();
  if (provider === "flutterwave") {
    return createFlutterwaveCheckout(input);
  }
  return createStripeCheckout(input);
}

export async function verifyPayment(reference: string, transactionId?: string | null): Promise<VerifiedPayment> {
  const provider = getActivePaymentProvider();
  if (provider === "flutterwave") {
    return verifyFlutterwavePayment(reference, transactionId);
  }
  return verifyStripePayment(reference);
}

export async function recordPendingPaymentIntent(input: {
  provider: PaymentProvider;
  reference: string;
  amountCents: number;
  currency: string;
  userId: string | null;
  boqId: string | null;
}): Promise<void> {
  const supabase = createServiceClient();
  const payload: Record<string, string | number | null> = {
    payment_provider: input.provider,
    payment_reference: input.reference,
    user_id: input.userId,
    amount_cents: input.amountCents,
    currency: input.currency.toLowerCase(),
    status: "pending",
    boq_id: input.boqId,
  };

  if (input.provider === "stripe") {
    payload.stripe_session_id = input.reference;
  }

  const { error } = await supabase
    .from("payments")
    .upsert(payload, { onConflict: "payment_reference", ignoreDuplicates: false });

  if (error) {
    logPostgrestError("Failed to record pending payment intent", error, "payments");
    throw error;
  }
}

export async function loadExpectedPayment(reference: string): Promise<ExpectedPayment> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payments")
    .select("payment_provider, payment_reference, payment_processor_reference, amount_cents, currency, user_id, boq_id, status")
    .eq("payment_reference", reference)
    .maybeSingle();

  if (error) {
    logPostgrestError("Failed to load expected payment", error, "payments");
    throw error;
  }

  if (!data?.payment_provider || !data.payment_reference) {
    throw new Error("Expected payment intent not found");
  }

  return {
    provider: data.payment_provider as PaymentProvider,
    reference: data.payment_reference,
    processorReference: data.payment_processor_reference ?? null,
    amountCents: data.amount_cents,
    currency: data.currency,
    userId: data.user_id ?? null,
    boqId: data.boq_id ?? null,
    status: data.status,
  };
}

export function assertPaymentMatchesExpected(payment: VerifiedPayment, expected: ExpectedPayment): void {
  if (payment.provider !== expected.provider) {
    throw new Error("Payment provider mismatch");
  }

  if (payment.reference !== expected.reference) {
    throw new Error("Payment reference mismatch");
  }

  if (payment.amountCents !== expected.amountCents) {
    throw new Error("Payment amount mismatch");
  }

  if (payment.currency.toLowerCase() !== expected.currency.toLowerCase()) {
    throw new Error("Payment currency mismatch");
  }
}

export async function persistCompletedPayment(input: PersistPaymentInput): Promise<void> {
  const supabase = createServiceClient();

  const paymentPayload: Record<string, string | number | null> = {
    payment_provider: input.provider,
    payment_reference: input.reference,
    payment_processor_reference: input.processorReference,
    user_id: input.userId,
    amount_cents: input.amountCents,
    currency: input.currency.toLowerCase(),
    status: "completed",
    boq_id: input.boqId,
  };

  if (input.provider === "stripe") {
    paymentPayload.stripe_session_id = input.reference;
    paymentPayload.stripe_payment_intent = input.processorReference;
  }

  const { data: paymentRow, error: paymentError } = await supabase
    .from("payments")
    .upsert(paymentPayload, { onConflict: "payment_reference", ignoreDuplicates: false })
    .select("id")
    .single();

  if (paymentError) {
    logPostgrestError("Failed to persist completed payment", paymentError, "payments");
    throw paymentError;
  }

  if (input.boqId) {
    const boqPatch: Record<string, string> = {
      payment_status: "paid",
      payment_provider: input.provider,
      payment_reference: input.reference,
    };

    if (input.provider === "stripe") {
      boqPatch.stripe_session_id = input.reference;
    }

    const { error: boqError } = await supabase
      .from("boqs")
      .update(boqPatch)
      .eq("id", input.boqId)
      .eq("payment_status", "preview");

    if (boqError) {
      logger.error("Failed to mark BOQ as paid", {
        boqId: input.boqId,
        provider: input.provider,
        error: String(boqError),
        route: "payments",
      });
    }
  }

  const refCode = input.metadata.ref_code;
  if (!refCode || !input.userId || !paymentRow?.id) {
    return;
  }

  const { data: existingReferral } = await supabase
    .from("referrals")
    .select("id")
    .eq("payment_id", paymentRow.id)
    .maybeSingle();

  if (existingReferral?.id) {
    return;
  }

  try {
    const { data: affiliate } = await supabase
      .from("affiliates")
      .select("id, user_id, commission_type, commission_value")
      .eq("referral_code", refCode)
      .eq("status", "active")
      .single();

    if (affiliate && affiliate.user_id !== input.userId) {
      const commission =
        affiliate.commission_type === "percent"
          ? Math.floor((input.amountCents * affiliate.commission_value) / 10000)
          : affiliate.commission_value;

      const { data: referralRow } = await supabase
        .from("referrals")
        .insert({
          affiliate_id: affiliate.id,
          referred_user_id: input.userId,
          payment_id: paymentRow.id,
          commission_cents: commission,
          status: "confirmed",
        })
        .select("id")
        .single();

      await supabase.rpc("increment_affiliate_earned", {
        p_affiliate_id: affiliate.id,
        p_amount: commission,
      });

      trackEvent(affiliate.user_id, "affiliate_commission_credited", {
        commissionCents: commission,
        referralId: referralRow?.id,
        paymentReference: input.reference,
      });
    }
  } catch (affiliateErr) {
    logger.error("Affiliate commission error", {
      error: affiliateErr instanceof Error ? affiliateErr.message : String(affiliateErr),
      refCode,
      route: "payments",
    });
  }
}

export function verifyFlutterwaveWebhookSignature(body: string, headers: Headers): boolean {
  const secretHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
  if (!secretHash) {
    if (isLocalDevelopmentUrl(getPublicAppUrl())) {
      logger.warn("FLUTTERWAVE_WEBHOOK_SECRET_HASH not set; allowing local webhook verification bypass", {
        route: "flutterwave-webhook",
      });
      return true;
    }

    return false;
  }

  const verifHash = headers.get("verif-hash");
  if (verifHash) {
    return verifHash === secretHash;
  }

  const signature = headers.get("flutterwave-signature");
  if (!signature) {
    return false;
  }

  if (signature === secretHash) {
    return true;
  }

  const expected = createHmac("sha256", secretHash).update(body).digest("hex");
  const left = Buffer.from(signature, "utf8");
  const right = Buffer.from(expected, "utf8");

  return left.length === right.length && timingSafeEqual(left, right);
}

function getFlutterwaveSecretKey(): string {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) {
    throw new Error("FLUTTERWAVE_SECRET_KEY is not configured");
  }
  return key;
}

function getFlutterwavePaymentOptions(): string {
  return process.env.FLUTTERWAVE_PAYMENT_OPTIONS ?? "card";
}

function getFlutterwaveBaseUrl(): string {
  return process.env.FLUTTERWAVE_BASE_URL ?? "https://api.flutterwave.com/v3";
}

function getFlutterwaveRedirectUrl(): string {
  const appUrl = getPublicAppUrl();
  if (isLocalDevelopmentUrl(appUrl)) {
    throw new Error(
      "Flutterwave requires NEXT_PUBLIC_APP_URL to be a public tunnel or deployed URL. Set it to your ngrok or cloudflared URL before testing payments."
    );
  }

  const parsed = new URL(appUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("Flutterwave redirect URLs must use HTTPS. Set NEXT_PUBLIC_APP_URL to a public HTTPS URL.");
  }

  return new URL("/payments/flutterwave/redirect", parsed).toString();
}

async function createFlutterwaveCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout> {
  const currency = getFlutterwaveCurrency();
  const redirectUrl = getFlutterwaveRedirectUrl();
  const paymentOptions = getFlutterwavePaymentOptions();

  const response = await fetch(`${getFlutterwaveBaseUrl()}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getFlutterwaveSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tx_ref: input.reference,
      amount: (input.amountCents / 100).toFixed(2),
      currency,
      redirect_url: redirectUrl,
      payment_options: paymentOptions,
      customer: {
        email: input.customerEmail,
        name: input.customerName ?? input.customerEmail,
      },
      meta: input.metadata,
      customizations: {
        title: input.title,
        description: input.description,
      },
    }),
  });

  const payload = (await response.json()) as {
    status?: string;
    message?: string;
    data?: {
      link?: string;
    };
  };

  if (!response.ok || payload.status !== "success" || !payload.data?.link) {
    throw new Error(payload.message || "Could not create Flutterwave checkout link");
  }

  logger.info("Flutterwave checkout created", {
    paymentReference: input.reference,
    amountCents: input.amountCents,
    currency,
    paymentOptions,
    redirectHost: new URL(redirectUrl).host,
    route: "checkout",
  });

  return {
    provider: "flutterwave",
    reference: input.reference,
    url: payload.data.link,
  };
}

async function createStripeCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout> {
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer_email: input.customerEmail,
    metadata: input.metadata,
    line_items: [
      {
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.amountCents,
          product_data: {
            name: input.title,
            description: input.description,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${input.origin}/generating?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/upload`,
  });

  return {
    provider: "stripe",
    reference: session.id,
    url: session.url ?? "",
  };
}

async function verifyStripePayment(reference: string): Promise<VerifiedPayment> {
  const stripeSession = await getStripe().checkout.sessions.retrieve(reference);

  return {
    provider: "stripe",
    reference,
    processorReference:
      typeof stripeSession.payment_intent === "string" ? stripeSession.payment_intent : stripeSession.payment_intent?.id ?? null,
    paid: stripeSession.payment_status === "paid",
    amountCents: stripeSession.amount_total ?? 0,
    currency: stripeSession.currency ?? "usd",
    metadata: stripeSession.metadata ?? {},
    customerEmail: stripeSession.customer_details?.email ?? stripeSession.customer_email ?? null,
  };
}

async function verifyFlutterwavePayment(reference: string, transactionId?: string | null): Promise<VerifiedPayment> {
  const endpoint = transactionId
    ? `${getFlutterwaveBaseUrl()}/transactions/${encodeURIComponent(transactionId)}/verify`
    : `${getFlutterwaveBaseUrl()}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`;

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${getFlutterwaveSecretKey()}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  const payload = (await response.json()) as FlutterwaveVerifyResponse;
  const data = payload.data;

  if (!response.ok || payload.status !== "success" || !data) {
    throw new Error(payload.message || "Could not verify Flutterwave payment");
  }

  logger.info("Flutterwave payment verification result", {
    paymentReference: data.tx_ref ?? reference,
    transactionId: data.id ? String(data.id) : transactionId ?? null,
    status: data.status ?? null,
    amount: data.amount ?? null,
    currency: data.currency ?? null,
    route: "payments",
  });

  return {
    provider: "flutterwave",
    reference: data.tx_ref ?? reference,
    processorReference: data.id ? String(data.id) : data.flw_ref ?? null,
    paid: data.status === "successful",
    amountCents: Math.round(Number(data.amount ?? 0) * 100),
    currency: data.currency ?? getFlutterwaveCurrency(),
    metadata: stringifyMetadata(data.meta),
    customerEmail: data.customer?.email ?? null,
  };
}

function stringifyMetadata(meta: Record<string, unknown> | undefined): PaymentMetadata {
  if (!meta) {
    return {};
  }

  const result: PaymentMetadata = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    result[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return result;
}

function isLocalDevelopmentUrl(appUrl: string): boolean {
  try {
    const parsed = new URL(appUrl);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function logPostgrestError(message: string, error: PostgrestError, route: string) {
  logger.error(message, {
    route,
    error: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}
