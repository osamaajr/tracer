import './landing-b.css';

function ChromeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M12 8h9M8.5 14 4 6m10 10-4 6" fill="none" stroke="currentColor" strokeWidth="1.7"/></svg>;
}

function InstallButton() {
  return <a className="lb-install" href="/#install"><ChromeIcon />Add to Chrome</a>;
}

export default function LandingB() {
  return (
    <main className="lb-page">
      <header className="lb-header">
        <a className="lb-logo" href="/landing-b" aria-label="Tracer home">
          <img src="/assets/landing-b/tracer-outline.png" alt="Tracer" />
        </a>
        <InstallButton />
      </header>
      <section className="lb-hero" aria-labelledby="lb-title">
        <div className="lb-copy">
          <h1 id="lb-title">Your personal<br /><span className="lb-outlined" data-text="money saver">money saver</span></h1>
          <p>Tracer watches your purchases after checkout and alerts you when prices drop or there's something worth acting on.</p>
          <InstallButton />
        </div>
      </section>
    </main>
  );
}
