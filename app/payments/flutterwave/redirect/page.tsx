import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";

type RedirectPageProps = {
  searchParams: Promise<{
    status?: string;
    tx_ref?: string;
    transaction_id?: string;
  }>;
};

export default async function FlutterwaveRedirectPage({ searchParams }: RedirectPageProps) {
  const params = await searchParams;
  const txRef = params.tx_ref;
  const transactionId = params.transaction_id;
  const status = params.status;

  logger.info("Flutterwave redirect page received", {
    paymentReference: txRef,
    transactionId,
    status,
    route: "flutterwave-redirect-page",
  });

  if (!txRef || status !== "successful") {
    const destination = new URLSearchParams();
    if (status) {
      destination.set("payment_status", status);
    }
    redirect(destination.size > 0 ? `/upload?${destination.toString()}` : "/upload");
  }

  const destination = new URLSearchParams({ session_id: txRef });
  if (transactionId) {
    destination.set("transaction_id", transactionId);
  }

  redirect(`/generating?${destination.toString()}`);
}
