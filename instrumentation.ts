import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    const { runMigrations } = await import("./lib/db/migrate");
    await runMigrations();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Automatically capture all unhandled server-side request errors
export const onRequestError = Sentry.captureRequestError;
