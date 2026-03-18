import Footer from "@/components/Footer";

export const metadata = {
  title: "Privacy Policy — BOQ Generator",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <nav className="border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="/" className="text-sm font-semibold text-white">
            BOQ <span className="text-amber-400">Generator</span>
          </a>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto px-4 py-16 space-y-10 text-gray-300">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-500">Last updated: 18 March 2026</p>
        </div>

        <p className="text-sm leading-relaxed">
          This Privacy Policy explains how BOQ Generator (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;us&rdquo;) collects, uses, stores, and protects your personal information when you use our service at this website. We are committed to complying with the General Data Protection Regulation (GDPR) and the Protection of Personal Information Act (POPIA) of South Africa.
        </p>

        <Section title="1. Who we are">
          <p>BOQ Generator is an AI-powered tool that generates Bills of Quantities from Scope of Work documents for construction professionals, primarily in Zambia and Southern Africa. For data protection enquiries, contact us at the address listed on the <a href="/contact" className="text-amber-400 hover:underline">Contact page</a>.</p>
        </Section>

        <Section title="2. What personal information we collect">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong className="text-white">Account information:</strong> Your name and email address, provided via Google Sign-In (OAuth).</li>
            <li><strong className="text-white">Payment information:</strong> Payment is processed by Stripe. We do not store your card details. We store your Stripe session ID and payment status to fulfil your order.</li>
            <li><strong className="text-white">Document content:</strong> The text extracted from your uploaded Scope of Work document is used solely to generate your BOQ. The raw file is never stored on our servers — only the extracted text and the resulting BOQ JSON are retained.</li>
            <li><strong className="text-white">Generated BOQs:</strong> Your BOQ data is saved to your account so you can access and edit it later.</li>
            <li><strong className="text-white">Usage data:</strong> Standard server logs (IP address, timestamps, request paths) for security and debugging. These are not sold or shared.</li>
          </ul>
        </Section>

        <Section title="3. How we use your information">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>To provide and deliver the BOQ generation service you paid for.</li>
            <li>To save your generated BOQs to your account for future access.</li>
            <li>To process and verify your payment via Stripe.</li>
            <li>To respond to support requests you submit.</li>
            <li>To maintain the security and performance of our service.</li>
          </ul>
          <p className="mt-3 text-sm">We do not use your data for advertising, and we do not sell your data to any third party.</p>
        </Section>

        <Section title="4. Legal basis for processing (GDPR)">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong className="text-white">Contract performance:</strong> Processing your document and payment to deliver the BOQ you purchased.</li>
            <li><strong className="text-white">Legitimate interests:</strong> Server logging for security and fraud prevention.</li>
            <li><strong className="text-white">Consent:</strong> By creating an account and uploading a document, you consent to the processing described in this policy.</li>
          </ul>
        </Section>

        <Section title="5. Third-party services">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong className="text-white">Supabase:</strong> Database and authentication hosting. Your account and BOQ data are stored in Supabase infrastructure.</li>
            <li><strong className="text-white">Stripe:</strong> Payment processing. Stripe&apos;s privacy policy applies to payment data.</li>
            <li><strong className="text-white">Google (OAuth):</strong> Used for sign-in only. We receive your name and email from Google with your consent.</li>
            <li><strong className="text-white">Google Gemini AI:</strong> The text of your uploaded document is sent to the Gemini API to generate the BOQ. This data is subject to Google&apos;s API data handling terms and is not used to train AI models under the standard API agreement.</li>
            <li><strong className="text-white">Vercel:</strong> Hosting provider for this application.</li>
          </ul>
        </Section>

        <Section title="6. Data retention">
          <p>Your account and BOQ data are retained for as long as your account is active. If you request deletion of your account, we will delete your personal data and BOQ records within 30 days, except where we are required to retain it for legal or accounting purposes (e.g., payment records, which are retained for 7 years in line with standard financial recordkeeping requirements).</p>
        </Section>

        <Section title="7. Your rights">
          <p>Under GDPR and POPIA, you have the right to:</p>
          <ul className="list-disc pl-5 space-y-1 text-sm mt-2">
            <li><strong className="text-white">Access</strong> the personal data we hold about you.</li>
            <li><strong className="text-white">Correct</strong> inaccurate data.</li>
            <li><strong className="text-white">Delete</strong> your data (&ldquo;right to be forgotten&rdquo;).</li>
            <li><strong className="text-white">Restrict</strong> processing of your data.</li>
            <li><strong className="text-white">Data portability:</strong> Receive your BOQ data in a machine-readable format (JSON/Excel).</li>
            <li><strong className="text-white">Withdraw consent</strong> at any time.</li>
          </ul>
          <p className="mt-3 text-sm">To exercise any of these rights, contact us via the <a href="/contact" className="text-amber-400 hover:underline">Contact page</a>.</p>
        </Section>

        <Section title="8. Cookies">
          <p>We use only essential session cookies required for authentication (provided by Supabase). We do not use tracking, analytics, or advertising cookies.</p>
        </Section>

        <Section title="9. Security">
          <p>All data is transmitted over HTTPS. Your BOQ data is stored in a secured Supabase database with row-level security — only you can access your own BOQs. Payments are handled entirely by Stripe; we never handle raw card data.</p>
        </Section>

        <Section title="10. Children">
          <p>This service is not directed at individuals under 18. We do not knowingly collect personal information from children.</p>
        </Section>

        <Section title="11. Changes to this policy">
          <p>We may update this Privacy Policy from time to time. We will notify you of material changes by email or by posting a notice on this site. Continued use of the service after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="12. Contact">
          <p>If you have questions or concerns about this Privacy Policy, please contact us via the <a href="/contact" className="text-amber-400 hover:underline">Contact page</a>.</p>
        </Section>
      </main>

      <Footer />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <div className="text-sm leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
