import { PostHog } from "posthog-node";

let _client: PostHog | null = null;

function getClient(): PostHog | null {
  if (process.env.NODE_ENV !== "production") return null;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  if (!_client) {
    _client = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      flushAt: 1,   // send immediately in serverless
      flushInterval: 0,
    });
  }
  return _client;
}

/**
 * Fire a server-side PostHog event. Fire-and-forget — never await this.
 * Falls back silently if PostHog is not configured.
 */
export function trackEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  const client = getClient();
  if (!client) return;
  try {
    client.capture({ distinctId, event, properties });
  } catch {
    // Never let analytics failures affect the response
  }
}
