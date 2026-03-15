"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Legacy route — redirect to dashboard.
// New BOQs open at /boq/[id] after generation.
export default function BOQPage() {
  const router = useRouter();
  useEffect(() => {
    // Handle old sessionStorage-based flow as a fallback
    const raw = sessionStorage.getItem("boq_data");
    if (raw) {
      // They have data from an old session — take them to dashboard
      sessionStorage.removeItem("boq_data");
    }
    router.replace("/dashboard");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
