import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="brand-mark" aria-label="ASA Scaliq Media House home">
        <span className="brand-mark-main">ASA SCALIQ</span>
        <span className="brand-mark-sub">Media House</span>
      </Link>
      <nav className="site-nav">
        <a href="#brief">Start a brief</a>
        <Link href="/admin">Team login</Link>
      </nav>
    </header>
  );
}
