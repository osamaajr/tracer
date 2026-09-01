import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  LockKeyhole,
  MailX,
  RefreshCw,
  Settings,
  ShoppingBag,
  Star,
  Tag,
  TimerReset,
  UsersRound,
} from "lucide-react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const demoUserId = "dev-user-afterbuy";

interface DashboardPurchase {
  id: string;
  retailerId: string;
  retailerName?: string;
  storeHost?: string;
  productName: string;
  pricePaidDisplay: string;
  currentPriceDisplay: string | null;
  purchasedAt: string;
  protectionStatus: string;
  lastCheckedAt: string | null;
  captureMethod?: string;
  captureConfidence?: string;
}

interface DashboardOpportunity {
  id: string;
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

const demoDashboard: DashboardData = {
  purchases: [
    {
      id: "demo-john-lewis",
      retailerId: "john-lewis",
      retailerName: "John Lewis",
      storeHost: "www.johnlewis.com",
      productName: "Sony WH-1000XM6 Wireless Bluetooth Noise Cancelling Headphones",
      pricePaidDisplay: "£349",
      currentPriceDisplay: "£319",
      purchasedAt: "2026-08-30T09:15:00.000Z",
      protectionStatus: "active",
      lastCheckedAt: "2026-09-01T08:00:00.000Z",
      captureMethod: "retailer_adapter",
      captureConfidence: "high",
    },
    {
      id: "demo-generic-store",
      retailerId: "store_shop-example-com",
      retailerName: "Shop",
      storeHost: "shop.example.com",
      productName: "Everyday Travel Pack",
      pricePaidDisplay: "£129",
      currentPriceDisplay: "£119",
      purchasedAt: "2026-08-29T17:45:00.000Z",
      protectionStatus: "active",
      lastCheckedAt: "2026-08-30T10:30:00.000Z",
      captureMethod: "generic_schema_org",
      captureConfidence: "high",
    },
  ],
  opportunities: [
    {
      id: "demo-opportunity",
      title: "Tracer found you £30",
      potentialSavingDisplay: "£30",
      originalPriceDisplay: "£349",
      currentPriceDisplay: "£319",
      claimBy: "2026-09-06",
      claimUrl: "https://www.johnlewis.com/customer-services/prices-and-payment/price-promise/request",
      guidance: "This may qualify under John Lewis Price Promise if the item is identical, in stock, and not excluded.",
      status: "open",
    },
  ],
};

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
        <p className="soft-pill"><span />The post-purchase assistant</p>
        <h1>Bought it?<br />We'll keep<br />watching it.</h1>
        <p className="hero-text">
          Tracer watches your purchases after checkout and alerts you when prices drop or there's something worth acting on.
        </p>
        <a className="primary-button hero-cta" href="#install">
          <ChromeMark />
          Add to Chrome - It's free
        </a>
        <div className="trust-strip" aria-label="Tracer trust highlights">
          <span><MailX aria-hidden="true" size={16} />No inbox access</span>
          <span><CreditCard aria-hidden="true" size={16} />No card details</span>
          <span><CheckCircle2 aria-hidden="true" size={16} />You choose what to protect</span>
        </div>
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
        <div className="extension-actions"><span className="status-pill">Active</span><Settings aria-hidden="true" size={14} /></div>
      </div>
      <div className="extension-copy">
        <h2>Bought it?<br />We'll keep watching it.</h2>
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
        <span><Tag aria-hidden="true" size={15} /><strong>Price drops</strong><small>We'll watch for changes</small></span>
        <span><CalendarCheck2 aria-hidden="true" size={15} /><strong>Policy windows</strong><small>We'll track known eligibility</small></span>
        <span><Bell aria-hidden="true" size={15} /><strong>Alerts</strong><small>We'll tell you when it matters</small></span>
      </div>
      <button className="protect-preview" type="button">Protect purchase</button>
      <button className="review-preview" type="button">Review details</button>
      <p className="extension-privacy"><LockKeyhole aria-hidden="true" size={14} />Only the details needed to track this purchase are saved.</p>
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
    <section className="chapter how-section" id="how-it-works">
      <div className="section-heading">
        <h2>How it works</h2>
      </div>
      <div className="steps-layout">
        <StepCard number="01" title="Buy normally" copy="Complete your purchase on any supported retailer's website." visual={<OrderMiniature />} />
        <StepCard number="02" title="Protect it" copy="Tracer recognises the purchase. One click adds it to your protected items." visual={<ProtectMiniature />} />
        <StepCard number="03" title="We keep watching" copy="If the price changes or there's something worth acting on, Tracer tells you." visual={<OpportunityMiniature />} />
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
  return <div className="opportunity-miniature" aria-hidden="true"><Bell size={21} /><p>£349.99 <span>-&gt;</span> £319.99</p><strong>£30 opportunity found</strong></div>;
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
  const [dashboard, setDashboard] = useState<DashboardData>(demoDashboard);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "offline">("idle");
  const [actingOpportunityId, setActingOpportunityId] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setStatus("loading");

    try {
      const response = await fetch(`${apiBaseUrl}/api/dashboard`, { headers: { "x-afterbuy-user-id": demoUserId } });
      if (!response.ok) {
        throw new Error("Dashboard API unavailable");
      }
      setDashboard((await response.json()) as DashboardData);
      setStatus("ready");
    } catch {
      setDashboard(demoDashboard);
      setStatus("offline");
    }
  }, []);

  useEffect(() => { void fetchDashboard(); }, [fetchDashboard]);

  const runMonitoring = useCallback(async () => {
    setStatus("loading");
    try {
      await fetch(`${apiBaseUrl}/api/dev/run-monitoring`, { method: "POST", headers: { "x-afterbuy-user-id": demoUserId } });
      await fetchDashboard();
    } catch {
      setStatus("offline");
    }
  }, [fetchDashboard]);

  const updateOpportunity = useCallback(async (opportunityId: string, action: "viewed" | "claim-clicked" | "dismiss") => {
    setActingOpportunityId(opportunityId);
    try {
      const response = await fetch(`${apiBaseUrl}/api/opportunities/${opportunityId}/${action}`, { method: "POST", headers: { "x-afterbuy-user-id": demoUserId } });
      if (!response.ok) {
        throw new Error("Opportunity action failed");
      }
      await fetchDashboard();
      return true;
    } catch {
      setStatus("offline");
      return false;
    } finally {
      setActingOpportunityId(null);
    }
  }, [fetchDashboard]);

  const claimOpportunity = useCallback(async (opportunity: DashboardOpportunity) => {
    const updated = await updateOpportunity(opportunity.id, "claim-clicked");
    if (updated) {
      window.open(opportunity.claimUrl, "_blank", "noopener,noreferrer");
    }
  }, [updateOpportunity]);

  const openOpportunity = useMemo(() => dashboard.opportunities.find((opportunity) => isActionableOpportunityStatus(opportunity.status)), [dashboard.opportunities]);
  const activeOpportunityCount = useMemo(() => dashboard.opportunities.filter((opportunity) => isActionableOpportunityStatus(opportunity.status)).length, [dashboard.opportunities]);
  const uniqueStoreCount = useMemo(() => new Set(dashboard.purchases.map((purchase) => retailerName(purchase))).size, [dashboard.purchases]);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <a className="brand" href="/" aria-label="Tracer home"><img className="brand-logo" src="/assets/tracer-logo.png" alt="" /><img className="brand-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" /></a>
        <div className="dashboard-actions">
          <span className={`status-dot ${status}`}>{statusLabel(status)}</span>
          <button className="icon-button" type="button" onClick={fetchDashboard}><RefreshCw aria-hidden="true" size={16} />Refresh</button>
          <button className="icon-button dark" type="button" onClick={runMonitoring}><TimerReset aria-hidden="true" size={16} />Run monitor</button>
        </div>
      </header>

      <section className="dashboard-summary">
        <div><p className="eyebrow">Protected purchases</p><h1>{dashboard.purchases.length}</h1></div>
        <div><p className="eyebrow">Open opportunities</p><h1>{activeOpportunityCount}</h1></div>
        <div><p className="eyebrow">Stores watched</p><h1>{uniqueStoreCount}</h1></div>
      </section>

      <section className="dashboard-grid">
        <div className="table-panel">
          <div className="panel-heading"><h2>Purchases</h2><span>Any-store capture</span></div>
          <div className="purchase-list">
            {dashboard.purchases.map((purchase) => (
              <article className="purchase-row" key={purchase.id}>
                <div><h3>{purchase.productName}</h3><p>{retailerName(purchase)} / {purchase.storeHost ?? purchase.retailerId} / purchased {formatDate(purchase.purchasedAt)}</p></div>
                <dl><div><dt>Paid</dt><dd>{purchase.pricePaidDisplay}</dd></div><div><dt>Current</dt><dd>{purchase.currentPriceDisplay ?? "Waiting"}</dd></div><div><dt>Capture</dt><dd>{captureLabel(purchase)}</dd></div></dl>
              </article>
            ))}
          </div>
        </div>

        <aside className="opportunity-panel">
          <div className="panel-heading"><h2>Opportunity</h2><Bell aria-hidden="true" size={18} /></div>
          {openOpportunity ? (
            <article className="dashboard-opportunity">
              <p className="retailer-label">Policy-backed claim</p>
              <h3>{openOpportunity.title}</h3>
              <dl><div><dt>You paid</dt><dd>{openOpportunity.originalPriceDisplay}</dd></div><div><dt>Now</dt><dd>{openOpportunity.currentPriceDisplay}</dd></div><div><dt>Claim by</dt><dd>{formatDate(openOpportunity.claimBy)}</dd></div></dl>
              <p>{openOpportunity.guidance}</p>
              <div className="opportunity-actions">
                <button className="claim-button" type="button" disabled={actingOpportunityId === openOpportunity.id} onClick={() => void claimOpportunity(openOpportunity)}>Claim {openOpportunity.potentialSavingDisplay}<ExternalLink aria-hidden="true" size={16} /></button>
                <button className="icon-button" type="button" disabled={actingOpportunityId === openOpportunity.id} onClick={() => void updateOpportunity(openOpportunity.id, "dismiss")}>Dismiss</button>
              </div>
            </article>
          ) : <p className="empty-state">No policy-backed opportunity yet. Generic stores can still be watched while retailer policies are added.</p>}
        </aside>
      </section>
    </main>
  );
}

function statusLabel(status: "idle" | "loading" | "ready" | "offline"): string {
  if (status === "loading") return "Loading";
  if (status === "ready") return "API connected";
  if (status === "offline") return "Demo data";
  return "Ready";
}

function retailerName(purchase: DashboardPurchase): string {
  return purchase.retailerName ?? (purchase.retailerId === "john-lewis" ? "John Lewis" : purchase.retailerId);
}

function captureLabel(purchase: DashboardPurchase): string {
  if (purchase.captureConfidence) return purchase.captureConfidence;
  if (purchase.retailerId === "john-lewis") return "high";
  return "tracked";
}

function isActionableOpportunityStatus(status: string): boolean {
  return status === "open" || status === "viewed";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(new Date(value));
}
