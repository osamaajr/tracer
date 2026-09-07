import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  CalendarCheck2,
  ChevronRight,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Settings,
  ShoppingBag,
  Star,
  Tag,
  UsersRound,
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
  const isDashboard = window.location.pathname.startsWith("/dashboard");
  return isDashboard ? <Dashboard /> : <LandingPage />;
}

function LandingPage() {
  return (
    <main className="landing-shell">
      <Header />
      <HeroSection />
      <TransitionStatement />
      <HowItWorksSection />
      <WatchingSection />
      <FinalCtaSection />
      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="Tracer home">
        <img className="brand-logo" src="/assets/tracer-logo.png" alt="" />
        <img className="brand-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" />
      </a>
      <nav className="nav-links" aria-label="Primary navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#privacy">Privacy</a>
        <a href="#faq">FAQ</a>
        <a href="#support">Support</a>
      </nav>
      <a className="header-cta" href="#install">
        <ChromeMark />
        Add to Chrome
        <ArrowRight aria-hidden="true" size={16} />
      </a>
    </header>
  );
}

function ChromeMark() {
  return (
    <span className="chrome-mark" aria-hidden="true">
      <i />
    </span>
  );
}

function HeroSection() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <h1>Bought it?<br />We'll keep<br />watching it.</h1>
        <p className="hero-text">
          Tracer watches your purchases after checkout and alerts you when prices drop or there's something worth acting on.
        </p>
        <a className="primary-button hero-cta" href="#install">
          <ChromeMark />
          Add to Chrome - It's free
        </a>
      </div>
      <div className="hero-stage" aria-label="Tracer purchase protection preview">
        <OrderWindow />
        <ExtensionPreview />
      </div>
    </section>
  );
}

function OrderWindow() {
  return (
    <article className="order-window" aria-label="Order confirmation example">
      <div className="browser-dots" aria-hidden="true"><span /><span /><span /><i /></div>
      <div className="receipt-brand">JOHN LEWIS</div>
      <div className="order-check"><CheckCircle2 aria-hidden="true" size={34} /></div>
      <h2>Thank you, Osama</h2>
      <p>Your order has been placed</p>
      <dl className="order-summary">
        <div><dt>Order number</dt><dd>JL1234567890</dd></div>
        <div><dt>Order total</dt><dd>£349.99</dd></div>
      </dl>
      <button type="button">View order details</button>
    </article>
  );
}

function ExtensionPreview() {
  return (
    <article className="extension-preview" aria-label="Tracer popup preview">
      <div className="extension-topbar">
        <div>
          <img className="mini-logo" src="/assets/tracer-logo.png" alt="" />
          <img className="extension-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" />
        </div>
        <div className="extension-actions"><Settings aria-hidden="true" size={14} /></div>
      </div>
      <div className="extension-copy">
        <h2>Purchase detected</h2>
        <p>We'll monitor this purchase for price drops and opportunities worth acting on.</p>
      </div>
      <section className="mini-product-card" aria-label="Protected purchase preview">
        <div className="mini-product-head">
          <ProductSilhouette />
          <div>
            <h3>Sony WH-1000XM5</h3>
            <p>Wireless Noise Cancelling Headphones</p>
          </div>
        </div>
        <dl>
          <div><dt>Paid</dt><dd>£349.99</dd></div>
          <div><dt>Retailer</dt><dd>John Lewis</dd></div>
          <div><dt>Purchase date</dt><dd>30 Aug 2026</dd></div>
          <div><dt>Product match</dt><dd className="exact-match">Exact match</dd></div>
        </dl>
        <div className="eligibility-row"><strong>Eligible window</strong><span>Until 30 Aug 2027</span></div>
      </section>
      <div className="mini-feature-row">
        <span><Tag aria-hidden="true" size={15} /><strong>PRICE DROPS</strong><small>We'll watch for changes</small></span>
        <span><CalendarCheck2 aria-hidden="true" size={15} /><strong>POLICY WINDOWS</strong><small>We'll track known eligibility</small></span>
        <span><Bell aria-hidden="true" size={15} /><strong>ALERTS</strong><small>We'll tell you when it matters</small></span>
      </div>
      <button className="protect-preview" type="button">Protect purchase</button>
      <p className="extension-privacy">Only the details needed to track this purchase are saved.</p>
    </article>
  );
}

function ProductSilhouette() {
  return <img className="product-image" src="/assets/product-headphones.png" alt="" />;
}

function TransitionStatement() {
  return (
    <section className="transition-statement">
      <h2>Shopping shouldn't end at checkout.</h2>
      <p>Buy something. Protect it. Tracer takes it from there.</p>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section className="how-section" id="how-it-works">
      <div className="how-section-inner">
        <div className="section-heading">
          <h2>How it works</h2>
        </div>
        <div className="steps-layout">
          <StepCard number="01" title="Buy normally" copy="Complete your purchase on any supported retailer's website." visual={<OrderMiniature />} />
          <StepCard number="02" title="Protect it" copy="Tracer recognises the purchase. One click adds it to your watchlist." visual={<ProtectMiniature />} />
          <StepCard number="03" title="We keep watching" copy="If the price changes or there's something worth acting on, Tracer tells you." visual={<OpportunityMiniature />} />
        </div>
      </div>
    </section>
  );
}

function StepCard({ number, title, copy, visual }: { number: string; title: string; copy: string; visual: ReactNode }) {
  return (
    <article className="step-card">
      <span className="step-number">{number}</span>
      <div className="step-visual">{visual}</div>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

function OrderMiniature() {
  return <div className="order-miniature" aria-hidden="true"><ShoppingBag size={45} /><CheckCircle2 className="mini-check" size={28} /></div>;
}

function ProtectMiniature() {
  return (
    <div className="protect-step-stage" aria-hidden="true">
      <div className="protect-browser-card"><span /><span /></div>
      <div className="protect-miniature"><img src="/assets/tracer-logo.png" alt="" /><b>Tracer</b><span>Bought it?</span><button type="button">Protect purchase</button></div>
    </div>
  );
}

function OpportunityMiniature() {
  return (
    <div className="opportunity-miniature" aria-hidden="true">
      <span className="opportunity-bell"><Bell size={17} /></span>
      <p>£349.99 <span>→</span> £319.99</p>
      <strong>£30 opportunity found</strong>
    </div>
  );
}

function WatchingSection() {
  const checklist = [
    "Price drops",
    "Policy & eligibility windows",
    "Refund & claim opportunities",
    "Back in stock alerts (coming soon)",
    "Works across leading retailers",
  ];

  return (
    <section className="chapter watching-section">
      <div className="chapter-copy">
        <h2>We watch so you don't have to.</h2>
        <ul className="watch-checklist">
          {checklist.map((item) => <li key={item}><CheckCircle2 aria-hidden="true" size={17} />{item}</li>)}
        </ul>
      </div>
      <MetricPanel />
    </section>
  );
}

function MetricPanel() {
  const metrics = [
    { icon: <UsersRound aria-hidden="true" size={30} />, value: "12,847+", label: "Purchases protected" },
    { icon: <Tag aria-hidden="true" size={30} />, value: "£268,431+", label: "Opportunities found" },
    { icon: <Clock aria-hidden="true" size={30} />, value: "3.2 min", label: "Average time saved per purchase" },
  ];

  return (
    <aside className="metric-panel" aria-label="Tracer proof panel">
      <div className="metric-row">
        {metrics.map((metric) => (
          <div className="metric-item" key={metric.label}>
            <span>{metric.icon}</span>
            <div><strong>{metric.value}</strong><small>{metric.label}</small></div>
          </div>
        ))}
      </div>
      <div className="rating-row">
        <span className="laurel" aria-hidden="true">‹</span>
        <div>
          <h3>Trusted by thousands of smart shoppers</h3>
          <div className="stars" aria-label="4.9 out of 5 stars">{Array.from({ length: 5 }, (_, index) => <Star key={index} aria-hidden="true" size={24} fill="currentColor" />)}</div>
          <p><strong>4.9 out of 5</strong><br />Chrome Web Store</p>
        </div>
        <span className="laurel" aria-hidden="true">›</span>
      </div>
    </aside>
  );
}

function FinalCtaSection() {
  return (
    <section className="final-cta-section" id="install">
      <div>
        <img src="/assets/tracer-logo.png" alt="" />
        <p className="eyebrow">Install Tracer</p>
        <h2>Start protecting your purchases today</h2>
        <p>Join thousands of shoppers who let Tracer watch their back.</p>
        <a className="primary-button" href="/dashboard"><ChromeMark />Add to Chrome - It's free</a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer" id="faq">
      <div className="footer-brand-block">
        <a className="brand" href="/" aria-label="Tracer home">
          <img className="brand-logo" src="/assets/tracer-logo.png" alt="" />
          <img className="brand-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" />
        </a>
        <p>Your purchases don't end at checkout.</p>
      </div>
      <nav className="footer-links" aria-label="Footer navigation">
        <div><h3>Product</h3><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a><a href="#faq">FAQ</a><a href="#support">Support</a></div>
        <div><h3>Company</h3><a href="#support">About</a><a href="#support">Blog</a><a href="#support">Careers</a><a href="#support">Contact</a></div>
        <div><h3>Legal</h3><a href="#privacy">Privacy Policy</a><a href="#support">Terms of Service</a></div>
      </nav>
      <div className="footer-card">
        <p>Made with care in the UK</p>
        <p>© 2026 Tracer. All rights reserved.</p>
      </div>
    </footer>
  );
}

function Dashboard() {
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

function retailerAsset(retailerId: string): string | null {
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
