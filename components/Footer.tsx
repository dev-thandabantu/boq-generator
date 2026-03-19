export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-transparent py-8 px-4">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-600">
        <span>© {new Date().getFullYear()} BOQ Generator. All rights reserved.</span>
        <nav className="flex items-center gap-5">
          <a href="/privacy" className="hover:text-gray-400 transition-colors">Privacy Policy</a>
          <a href="/terms" className="hover:text-gray-400 transition-colors">Terms of Service</a>
          <a href="/contact" className="hover:text-gray-400 transition-colors">Contact & Support</a>
        </nav>
      </div>
    </footer>
  );
}
