import "./landing-b.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  Bell,
  Bookmark,
  ChevronRight,
  CheckCircle2,
  Globe2,
  MoreHorizontal,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  X,
} from "lucide-react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const demoUserId = "dev-user-afterbuy";

interface DashboardPurchase {
  id: string;
  retailerId: string;
  retailerName?: string;
  storeHost?: string;
  productName: string;
  productUrl?: string;
  imageUrl?: string;
  pricePaidDisplay: string;
  currentPriceDisplay: string | null;
  purchasedAt: string;
  protectionStatus: string;
  lastCheckedAt: string | null;
  captureMethod?: string;
  captureConfidence?: string;
  recentActivity?: DashboardActivityEvent[];
}

interface DashboardActivityEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  occurredAt: string;
}

interface DashboardOpportunity {
  id: string;
  purchaseId: string;
  title: string;
  potentialSavingDisplay: string;
  originalPriceDisplay: string;
  currentPriceDisplay: string;
  claimBy: string;
  claimUrl: string;
  guidance: string;
  status: string;
}

interface DashboardData {
  purchases: DashboardPurchase[];
  opportunities: DashboardOpportunity[];
}

export function App() {
  const pathname = normalisePathname(window.location.pathname);
  const isDashboard = pathname.startsWith("/dashboard");
  useEffect(() => {
    if (isDashboard) window.location.replace("/");
  }, [isDashboard]);

  if (isDashboard) return null;
  if (pathname === "/landing-b") return <LandingPageB />;
  if (pathname === "/contact") return <ContactPage />;
  if (pathname === "/privacy") return <PrivacyPage />;
  if (pathname === "/terms") return <TermsPage />;
  return <LandingPageB />;
}

function normalisePathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

function LandingPageB() {
  const skyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    let frame = 0;
    const updateSky = () => {
      frame = 0;
      const shift = Math.min(window.scrollY * 0.035, 24);
      skyRef.current?.style.setProperty("--landing-b-sky-shift", `${shift}px`);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateSky);
    };

    updateSky();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <main className="landing-shell landing-shell-b">
      <div className="landing-b-sky" ref={skyRef}>
        <LandingHeader />
        <HeroSectionB />
        <div className="landing-b-cloud-bridge" aria-hidden="true" />
      </div>
      <LandingBValueStatement />
      <LandingBFeatures />
      <Footer />
    </main>
  );
}

function HeroSectionB() {
  return (
    <section className="hero landing-b-hero" id="install">
      <div className="hero-copy">
        <h1>Save it.<br />We’ll keep watching it.</h1>
        <p className="hero-text">
          Save products from any website, come back anytime, and let Tracer keep an eye on the price — even after you buy.
        </p>
        <a className="primary-button hero-cta" href="#install">
          <ChromeMark />
          Add to Chrome - It's free
        </a>
      </div>
      <div className="hero-stage landing-b-hero-stage" aria-label="Tracer purchase monitoring preview">
        <HeroMonitoringVisual />
      </div>
    </section>
  );
}

interface FloatingAlertCardProps {
  className: string;
  copy: ReactNode;
  icon: ReactNode;
  time: string;
  title: string;
  tone: "red" | "blue" | "amber";
}

function FloatingAlertCard({ className, copy, icon, time, title, tone }: FloatingAlertCardProps) {
  return (
    <article className={`landing-b-alert-card landing-b-hover-card ${className}`} tabIndex={0}>
      <span className="landing-b-rays" aria-hidden="true"><i /><i /><i /></span>
      <span className={`landing-b-alert-icon landing-b-alert-icon-${tone}`}>{icon}</span>
      <div className="landing-b-alert-copy"><strong>{title}</strong><p>{copy}</p></div>
      <time>{time}</time>
    </article>
  );
}

function HeroMonitoringVisual() {
  return (
    <div className="landing-b-card-scene">
      <article className="landing-b-watch-card landing-b-hover-card" tabIndex={0}>
        <header>
          <img src="/assets/landing-b/tracer-wordmark-outline-transparent.png" alt="Tracer" />
          <MoreHorizontal aria-hidden="true" size={20} />
        </header>
        <div className="landing-b-watch-body">
          <span className="landing-b-watch-icon"><Bookmark aria-hidden="true" size={25} /></span>
          <div>
            <h2>Watching your item</h2>
            <p>Saved or purchased, Tracer keeps checking the price for you.</p>
          </div>
        </div>
        <footer>
          <span><CheckCircle2 aria-hidden="true" size={14} />Saved</span>
          <span>Protect after checkout</span>
        </footer>
      </article>

      <FloatingAlertCard
        className="landing-b-alert-price"
        copy="This item is now £28 less."
        icon={<ArrowDown aria-hidden="true" size={24} />}
        time="2h ago"
        title="Price drop detected"
        tone="red"
      />
      <FloatingAlertCard
        className="landing-b-alert-up"
        copy={<><span>Keep products from any</span><br />website in one place.</>}
        icon={<Globe2 aria-hidden="true" size={24} />}
        time="Just now"
        title="Saved from anywhere"
        tone="blue"
      />
      <FloatingAlertCard
        className="landing-b-alert-return"
        copy="You bought a saved item. Tracer will keep watching for price drops."
        icon={<ShoppingBag aria-hidden="true" size={23} />}
        time="Just now"
        title="Purchase detected"
        tone="amber"
      />
    </div>
  );
}

function LandingBValueStatement() {
  return (
    <section className="landing-b-value">
      <h2>No more scattered wishlists, bookmarks, or tabs.</h2>
      <p className="landing-b-watchlist-note">Save products from any website into one place, come back whenever you want, and let Tracer keep an eye on the price while they’re there.</p>
      <div className="landing-b-video-placeholder" role="img" aria-label="Tracer product demo video placeholder">
        <div className="landing-b-video-bar" aria-hidden="true">
          <span /><span /><span />
          <p>Tracer in action</p>
          <small>Demo video</small>
        </div>
        <div className="landing-b-video-poster">
          <div className="landing-b-video-play" aria-hidden="true"><i /></div>
          <strong>See how Tracer keeps watch</strong>
          <p>Product demo coming soon</p>
        </div>
      </div>
    </section>
  );
}

function LandingBFeatures() {
  return (
    <section className="landing-b-body-section landing-b-features" aria-label="Tracer benefits">
      <div className="landing-b-editorial-features">
        <article className="landing-b-editorial-feature">
          <div className="landing-b-editorial-copy">
            <h3>Keep every find in one place.</h3>
            <p>Save products from any shop and pick up where you left off.</p>
          </div>
          <div className="landing-b-feature-visual landing-b-save-visual" aria-label="Tracer saved items example">
            <div className="landing-b-save-card landing-b-update-card">
              <header>
                <span><Globe2 aria-hidden="true" size={20} /></span>
                <div><strong>Saved items</strong><p>Products you want, all together.</p></div>
                <Bookmark aria-hidden="true" size={18} />
              </header>
              <div className="landing-b-save-detail"><Bookmark aria-hidden="true" size={18} /><span>Items ready when you are</span><strong>12</strong></div>
            </div>
          </div>
        </article>

        <article className="landing-b-editorial-feature landing-b-editorial-feature-reversed">
          <div className="landing-b-editorial-copy">
            <h3>We watch the price for you.</h3>
            <p>Tracer keeps checking saved and purchased items, then lets you know when the price drops.</p>
          </div>
          <div className="landing-b-feature-visual landing-b-drop-visual" aria-label="Tracer price-drop notification example">
            <div className="landing-b-feature-alert landing-b-feature-alert-combined">
              <span className="landing-b-feature-alert-icon"><ArrowDown aria-hidden="true" size={25} /></span>
              <div><strong>Price drop detected</strong><p>Your headphones are now £319.99.</p></div>
              <time>Just now</time>
              <div className="landing-b-feature-price-row">
                <span><small>You paid</small><strong>£349.99</strong></span>
                <ArrowRight aria-hidden="true" size={20} />
                <span><small>Now</small><strong>£319.99</strong></span>
                <em>£30 back</em>
              </div>
            </div>
          </div>
        </article>

        <article className="landing-b-editorial-feature">
          <div className="landing-b-editorial-copy">
            <h3>Only hear about changes worth knowing.</h3>
            <p>Get a heads-up when a price or policy change could save you money.</p>
          </div>
          <div className="landing-b-feature-visual landing-b-update-visual" aria-label="Tracer activity alert example">
            <div className="landing-b-update-card">
              <header>
                <span><Bell aria-hidden="true" size={20} /></span>
                <div><strong>Worth a look</strong><p>A meaningful change was found.</p></div>
                <time>Now</time>
              </header>
              <div className="landing-b-update-detail">
                <span><TrendingUp aria-hidden="true" size={21} /></span>
                <div><strong>£30 saving found</strong><p>Review your options before you miss it.</p></div>
                <ChevronRight aria-hidden="true" size={20} />
              </div>
            </div>
          </div>
        </article>

        <article className="landing-b-editorial-feature landing-b-editorial-feature-reversed">
          <div className="landing-b-editorial-copy">
            <h3>Protect it once. We keep watch.</h3>
            <p>After checkout, Tracer keeps checking for price drops and refund opportunities.</p>
          </div>
          <div className="landing-b-feature-visual landing-b-monitor-visual" aria-label="Tracer protected-purchase monitoring example">
            <div className="landing-b-monitor-card">
              <div className="landing-b-monitor-product">
                <img className="landing-b-monitor-product-image" src="/assets/product-headphones.png" alt="Sony WH-1000XM5 headphones" />
                <div><strong>Sony WH-1000XM5</strong><p>John Lewis</p></div>
              </div>
              <dl>
                <div><dt>Paid</dt><dd>£349.99</dd></div>
                <div><dt>Current price</dt><dd>£349.99</dd></div>
              </dl>
              <footer><span><CheckCircle2 aria-hidden="true" size={15} /> Watching for drops</span><small><CheckCircle2 aria-hidden="true" size={13} /> Checked just now</small></footer>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function LandingHeader({ homeHref = "/", installHref = "#install" }: { homeHref?: string; installHref?: string }) {
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // Hysteresis avoids flickering around the transition point.
      setFloating((previous) => window.scrollY > (previous ? 20 : 48));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="landing-header-space">
      <header className="site-header landing-header" data-floating={floating}>
        <a className="brand" href={homeHref} aria-label="Tracer home">
          <img className="brand-logo" src="/assets/tracer-logo.png" alt="" />
          <img className="brand-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" />
        </a>
        <a className="header-cta" href={installHref}>
          <ChromeMark />
          Add to Chrome
          <ArrowRight aria-hidden="true" size={16} />
        </a>
      </header>
    </div>
  );
}

function ChromeMark() {
  return (
    <svg className="chrome-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z" fill="currentColor" />
    </svg>
  );
}

function Footer() {
  return (
    <footer className="site-footer" id="faq">
      <div className="footer-clouds" aria-hidden="true"><span /><span /></div>
      <div className="footer-row">
        <div className="brand" aria-label="Tracer">
          <img className="brand-logo" src="/assets/tracer-logo.png" alt="" />
          <img className="brand-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" />
        </div>
        <nav className="footer-links" aria-label="Footer navigation">
          <a href="mailto:osama.alnajar.26@gmail.com">Contact</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </div>
      <p className="footer-copyright">© 2026 Tracer. All rights reserved.</p>
      <div className="footer-giant-wordmark" aria-hidden="true"><span>T<em>r</em>acer</span></div>
    </footer>
  );
}

function SitePage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Tracer`;
  }, [title]);

  return (
    <main className="site-page-shell landing-shell-b landing-b-subpage">
      <LandingHeader homeHref="/" installHref="/#install" />
      <div className="site-page-main">
        <header className="site-page-intro">
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        {children}
      </div>
      <Footer />
    </main>
  );
}

function ContactPage() {
  return (
    <SitePage
      title="Contact"
      description="Questions, feedback, or support requests? Get in touch and we’ll do our best to help."
    >
      <section className="contact-card" aria-labelledby="contact-email-heading">
        <div>
          <p className="contact-label" id="contact-email-heading">Email</p>
          <a className="contact-address" href="mailto:osama.alnajar.26@gmail.com">
            osama.alnajar.26@gmail.com
          </a>
          <p>Tracer is currently in its early version, so email is the best way to get in touch.</p>
        </div>
        <a className="primary-button contact-button" href="mailto:osama.alnajar.26@gmail.com">
          Email us
          <ArrowRight aria-hidden="true" size={16} />
        </a>
      </section>
    </SitePage>
  );
}

function PrivacyPage() {
  return (
    <SitePage title="Privacy Policy" description="How Tracer handles your data.">
      <article className="policy-document">
        <PolicySection title="Introduction">
          <p>Tracer helps you monitor purchases you choose to protect after checkout. Privacy and minimal data collection are part of how the product is designed: Tracer aims to use only the information needed to provide its core features.</p>
        </PolicySection>

        <PolicySection title="What Tracer stores">
          <p>Tracer may store the details needed to protect and monitor a purchase, including:</p>
          <ul>
            <li>Product and retailer names.</li>
            <li>Purchase date and purchase price, when available.</li>
            <li>Monitoring status and price-related information.</li>
            <li>Your notification and monitoring preferences.</li>
          </ul>
        </PolicySection>

        <PolicySection title="What Tracer does not aim to collect" emphasis>
          <p>Tracer is designed to avoid unnecessary data collection.</p>
          <ul>
            <li>Tracer does not require access to your email inbox.</li>
            <li>Tracer does not ask for your payment-card details.</li>
            <li>Tracer saves only the purchases you choose to protect.</li>
            <li>Tracer is intended to use only the information needed for its core functionality.</li>
          </ul>
        </PolicySection>

        <PolicySection title="How data is used">
          <p>Stored information is used to monitor protected purchases, surface relevant price changes or purchase updates, power your saved-purchase list, and remember your settings.</p>
        </PolicySection>

        <PolicySection title="Browser and extension storage">
          <p>Tracer may store relevant purchase and settings data locally in your browser or extension storage in order to power the product experience.</p>
        </PolicySection>

        <PolicySection title="Third-party services">
          <p>Tracer may rely on third-party services or infrastructure to operate certain parts of the product. Where applicable, those services may process limited data needed to provide the service.</p>
        </PolicySection>

        <PolicySection title="Your controls">
          <p>You can turn monitoring on or off, turn price-drop alerts on or off, and clear protected purchases from your device through the extension settings.</p>
        </PolicySection>

        <PolicySection title="Data retention">
          <p>Tracer keeps relevant data only as needed to support its functionality, or until you clear it where that control is available.</p>
        </PolicySection>

        <PolicySection title="Changes to this policy">
          <p>We may update this policy from time to time as Tracer evolves. The latest version will be published on this page.</p>
        </PolicySection>

        <PolicySection title="Contact">
          <p>If you have privacy-related questions, contact <a href="mailto:osama.alnajar.26@gmail.com">osama.alnajar.26@gmail.com</a>.</p>
        </PolicySection>
      </article>
    </SitePage>
  );
}

function TermsPage() {
  return (
    <SitePage title="Terms of Service" description="The basic terms for using Tracer.">
      <article className="policy-document">
        <PolicySection title="Acceptance of terms">
          <p>By using Tracer, you agree to these terms. If you do not agree, please do not use the service.</p>
        </PolicySection>

        <PolicySection title="What Tracer is">
          <p>Tracer is a tool designed to help users monitor selected purchases after checkout and surface information that may be useful.</p>
        </PolicySection>

        <PolicySection title="Use of the service">
          <p>You agree to use Tracer lawfully and responsibly, and not to misuse, disrupt, or attempt to interfere with the service.</p>
        </PolicySection>

        <PolicySection title="Service availability">
          <p>Tracer is provided on an “as is” and “as available” basis. Features, monitoring coverage, and availability may change over time, and uninterrupted service is not guaranteed.</p>
        </PolicySection>

        <PolicySection title="Accuracy and limitations" emphasis>
          <p>Tracer aims to surface useful information, but it does not guarantee perfect retailer coverage, uninterrupted monitoring, or completely accurate and up-to-date price or policy information at all times.</p>
        </PolicySection>

        <PolicySection title="Your responsibility">
          <p>You remain responsible for your purchase decisions, claims, retailer interactions, and for checking relevant details before acting on an alert or update from Tracer.</p>
        </PolicySection>

        <PolicySection title="Intellectual property">
          <p>The Tracer product, brand, and site content belong to Tracer unless otherwise stated. These terms do not transfer ownership of that material to you.</p>
        </PolicySection>

        <PolicySection title="Changes to the service">
          <p>Tracer may update, modify, suspend, or discontinue features as the product develops.</p>
        </PolicySection>

        <PolicySection title="Changes to these terms">
          <p>We may update these terms from time to time. The latest version will be published on this page.</p>
        </PolicySection>

        <PolicySection title="Contact">
          <p>If you have questions about these terms, contact <a href="mailto:osama.alnajar.26@gmail.com">osama.alnajar.26@gmail.com</a>.</p>
        </PolicySection>
      </article>
    </SitePage>
  );
}

function PolicySection({
  title,
  emphasis = false,
  children,
}: {
  title: string;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="policy-section" data-emphasis={emphasis}>
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function _Dashboard() {
  const [dashboard, setDashboard] = useState<DashboardData>({ purchases: [], opportunities: [] });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "offline">("idle");
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const displayName = getDashboardDisplayName();

  const fetchDashboard = useCallback(async () => {
    setStatus("loading");

    try {
      const response = await fetch(`${apiBaseUrl}/api/dashboard`, { headers: { "x-afterbuy-user-id": demoUserId } });
      if (!response.ok) {
        throw new Error("Dashboard API unavailable");
      }
      const nextDashboard = (await response.json()) as DashboardData;
      setDashboard(nextDashboard);
      setStatus("ready");
    } catch {
      setDashboard({ purchases: [], opportunities: [] });
      setStatus("offline");
    }
  }, []);

  useEffect(() => { void fetchDashboard(); }, [fetchDashboard]);

  const activeOpportunities = useMemo(
    () => dashboard.opportunities.filter((opportunity) => isActionableOpportunityStatus(opportunity.status)),
    [dashboard.opportunities],
  );
  const purchasesByAlert = useMemo(() => {
    const alertMap = new Map<string, DashboardOpportunity[]>();
    activeOpportunities.forEach((opportunity) => {
      const current = alertMap.get(opportunity.purchaseId) ?? [];
      current.push(opportunity);
      alertMap.set(opportunity.purchaseId, current);
    });
    return alertMap;
  }, [activeOpportunities]);
  const visiblePurchases = useMemo(() => {
    return [...dashboard.purchases].sort((left, right) => {
      return new Date(right.purchasedAt).getTime() - new Date(left.purchasedAt).getTime();
    });
  }, [dashboard.purchases]);
  const selectedPurchase = useMemo(() => {
    return dashboard.purchases.find((purchase) => purchase.id === selectedPurchaseId) ?? null;
  }, [dashboard.purchases, selectedPurchaseId]);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-logo-row">
        <a className="brand" href="/" aria-label="Tracer home">
          <img className="brand-logo" src="/assets/tracer-logo.png" alt="" />
          <img className="brand-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" />
        </a>
      </header>

      <section className="dashboard-hero">
        <div>
          <h1>Good morning, {firstName(displayName)}</h1>
          <p>Your protected purchases, all in one place.</p>
        </div>
        <span className="sr-only" aria-live="polite">{statusLabel(status)}</span>
      </section>

      <section className="dashboard-workspace" aria-label="Protected purchases dashboard">
        <div className="purchases-heading">
          <div>
            <h2>Your purchases</h2>
            <span>{dashboard.purchases.length} protected</span>
          </div>
          <span className="sort-copy">Newest first</span>
        </div>

        <div className="purchase-list">
          {visiblePurchases.map((purchase) => (
            <PurchaseRow
              key={purchase.id}
              purchase={purchase}
              alerts={purchasesByAlert.get(purchase.id) ?? []}
              selected={selectedPurchase?.id === purchase.id}
              onSelect={() => setSelectedPurchaseId(purchase.id)}
            />
          ))}
        </div>

        <section className="dashboard-rest-card" aria-label="Monitoring status">
          <LeafIcon />
          <div>
            <h3>You're all set</h3>
            <p>We're monitoring {dashboard.purchases.length} purchases for price drops.</p>
          </div>
          <p>Sit back and we'll keep an eye on the prices for you.</p>
        </section>
      </section>

      <div className="drawer-overlay" data-open={Boolean(selectedPurchase)} onClick={() => setSelectedPurchaseId(null)} />
      <PurchaseDetailDrawer
        purchase={selectedPurchase}
        onClose={() => setSelectedPurchaseId(null)}
      />
    </main>
  );
}

function PurchaseRow({
  purchase,
  alerts,
  selected,
  onSelect,
}: {
  purchase: DashboardPurchase;
  alerts: DashboardOpportunity[];
  selected: boolean;
  onSelect: () => void;
}) {
  const primaryAlert = alerts[0];

  return (
    <button className="purchase-row" data-selected={selected} type="button" onClick={onSelect}>
      <span className="purchase-main">
        <strong>{purchase.productName}</strong>
        <small>{retailerName(purchase)}</small>
      </span>
      <span className="purchase-date">
        <small>Purchased</small>
        {formatDate(purchase.purchasedAt)}
      </span>
      <StatusPill purchase={purchase} alert={primaryAlert} />
      <ChevronRight className="row-chevron" aria-hidden="true" size={22} />
    </button>
  );
}

function StatusPill({ purchase, alert }: { purchase: DashboardPurchase; alert?: DashboardOpportunity | undefined }) {
  if (alert) {
    return (
      <span className="purchase-status alert">
        <i />
        <span>
          <strong>Price drop</strong>
          <small>{alert.potentialSavingDisplay} less {savingPercent(alert)}</small>
        </span>
      </span>
    );
  }

  if (!purchase.currentPriceDisplay) {
    return <span className="purchase-status neutral"><i />Watching</span>;
  }

  return <span className="purchase-status neutral"><i />No change</span>;
}

function PurchaseDetailDrawer({
  purchase,
  onClose,
}: {
  purchase: DashboardPurchase | null;
  onClose: () => void;
}) {
  return (
    <aside className="purchase-drawer" data-open={Boolean(purchase)} aria-hidden={!purchase} aria-label={purchase ? `${purchase.productName} details` : "Purchase details"}>
      {purchase ? (
        <>
          <button className="drawer-close" type="button" aria-label="Close purchase details" onClick={onClose}>
            <X aria-hidden="true" size={25} />
          </button>

          <section className="drawer-product-head">
            <div>
              <h2>{purchase.productName}</h2>
              <p>{retailerName(purchase)}</p>
              <span className="monitoring-inline"><i />Monitoring active</span>
            </div>
          </section>

          <dl className="drawer-values">
            <div><dt>Purchase date</dt><dd>{formatDate(purchase.purchasedAt)}</dd></div>
            <div><dt>Paid price</dt><dd>{purchase.pricePaidDisplay}</dd></div>
            <div><dt>Current price</dt><dd>{purchase.currentPriceDisplay ?? purchase.pricePaidDisplay}</dd></div>
          </dl>

          <section className="protection-summary">
            <ShieldCheck aria-hidden="true" size={42} />
            <div>
              <h3>Protected for {protectionDays(purchase)} days</h3>
              <p>Eligible for price protection until {formatDate(protectionUntil(purchase))}.</p>
            </div>
          </section>

          <section className="activity-section">
            <h3>Recent activity</h3>
            {purchase.recentActivity && purchase.recentActivity.length > 0 ? (
              <ol className="activity-timeline">
                {purchase.recentActivity.map((activity, index) => (
                  <li key={activity.id} data-current={index === 0}>
                    <time>{formatActivityTime(activity.occurredAt)}</time>
                    <div>
                      <h4>{activity.title}</h4>
                      <p>{activity.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="activity-empty">
                <h4>No checks yet</h4>
                <p>Activity will appear here after the next monitoring run.</p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </aside>
  );
}

function LeafIcon() {
  return (
    <span className="leaf-icon" aria-hidden="true">
      <svg viewBox="0 0 28 28">
        <path d="M22.8 4.8C13 5.6 6.2 11.1 6.2 20.6c7.4.2 14.7-4.7 16.6-15.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5.2 23.4c4.8-6.2 9.1-9.8 14.4-12.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    </span>
  );
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  const now = new Date();

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (date.toDateString() === now.toDateString()) {
    return `Today, ${date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  return formatDate(value);
}

function protectionDays(purchase: DashboardPurchase): number {
  const purchasedAt = new Date(purchase.purchasedAt).getTime();
  const until = protectionUntil(purchase).getTime();
  return Math.max(1, Math.round((until - purchasedAt) / 86_400_000));
}

function protectionUntil(purchase: DashboardPurchase): Date {
  const date = new Date(purchase.purchasedAt);
  date.setDate(date.getDate() + 60);
  return date;
}

function statusLabel(status: "idle" | "loading" | "ready" | "offline"): string {
  if (status === "loading") return "Loading";
  if (status === "ready") return "Local data";
  if (status === "offline") return "Preview data";
  return "Local";
}

function retailerName(purchase: DashboardPurchase): string {
  return purchase.retailerName ?? (purchase.retailerId === "john-lewis" ? "John Lewis" : purchase.retailerId);
}

function _retailerAsset(retailerId: string): string | null {
  const assets: Record<string, string> = {
    amazon: "/assets/store-amazon.png",
    apple: "/assets/store-apple.png",
    argos: "/assets/store-argos.svg",
    asos: "/assets/store-asos.svg",
    currys: "/assets/store-currys.png",
    "john-lewis": "/assets/store-john-lewis.png",
    nike: "/assets/store-nike.svg",
  };

  return assets[retailerId] ?? null;
}

function isActionableOpportunityStatus(status: string): boolean {
  return status === "open" || status === "viewed";
}

function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function getDashboardDisplayName(): string {
  const params = new URLSearchParams(window.location.search);
  const nameFromUrl = params.get("name")?.trim();
  if (nameFromUrl) {
    window.localStorage.setItem("tracerDisplayName", nameFromUrl);
    return nameFromUrl;
  }

  return window.localStorage.getItem("tracerDisplayName") ?? "Osama";
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? value;
}

function moneyToNumber(value: string): number | null {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function savingPercent(opportunity: DashboardOpportunity): string {
  const original = moneyToNumber(opportunity.originalPriceDisplay);
  const saving = moneyToNumber(opportunity.potentialSavingDisplay);
  if (!original || !saving) {
    return "";
  }

  return `(${Math.round((saving / original) * 100)}%)`;
}
