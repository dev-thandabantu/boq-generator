import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const response = NextResponse.next();

  // Capture referral code from ?ref= query param and persist in a 30-day cookie.
  // First-click wins: we don't overwrite an existing ref_code cookie.
  const refCode = req.nextUrl.searchParams.get("ref");
  if (refCode && !req.cookies.has("ref_code")) {
    // Basic validation: alphanumeric, 4-20 chars
    if (/^[a-zA-Z0-9]{4,20}$/.test(refCode)) {
      response.cookies.set("ref_code", refCode, {
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: "/",
        sameSite: "lax",
        httpOnly: false, // accessible by client JS for display purposes
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
