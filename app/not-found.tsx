import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-1">
          <p className="text-6xl font-bold text-amber-400">404</p>
          <h2 className="text-xl font-semibold text-white">Page not found</h2>
          <p className="text-sm text-zinc-400">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
        </div>
        <Link
          href="/dashboard"
          className="inline-block px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-black font-semibold rounded-lg transition-colors text-sm"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
