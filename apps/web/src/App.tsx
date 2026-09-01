import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  CreditCard,
  Database,
  ExternalLink,
  LockKeyhole,
  MailX,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Tag,
  TimerReset,
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

interface ShopCard {
  name: string;
  status: string;
  logoSrc: string;
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

const verifiedShopCards: ShopCard[] = [
  { name: "John Lewis", status: "Enhanced policy support", logoSrc: "/assets/store-john-lewis.png" },
];

const roadmapShopCards: ShopCard[] = [
  { name: "Shopify", status: "Generic order detection planned", logoSrc: "/assets/store-shopify.svg" },
  { name: "WooCommerce", status: "Generic order detection planned", logoSrc: "/assets/store-woocommerce.svg" },
  { name: "Argos", status: "Policy support planned", logoSrc: "/assets/store-argos.svg" },
  { name: "Amazon", status: "Researching support", logoSrc: "/assets/store-amazon.png" },
  { name: "Currys", status: "Researching support", logoSrc: "/assets/store-currys.png" },
  { name: "Apple", status: "Researching support", logoSrc: "/assets/store-apple.png" },
];

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
      <OpportunitySection />
      <PrivacySection />
      <StoreCoverageSection />
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
        <span className="status-pill">Active</span>
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
        <span><Tag aria-hidden="true" size={15} />Price drops</span>
        <span><CalendarCheck2 aria-hidden="true" size={15} />Policy windows</span>
        <span><Bell aria-hidden="true" size={15} />Alerts</span>
      </div>
      <button className="protect-preview" type="button">Protect purchase</button>
      <button className="review-preview" type="button">Review details</button>
      <p className="extension-privacy"><LockKeyhole aria-hidden="true" size={14} />Only the details needed to track this purchase are saved.</p>
    </article>
  );
}

function ProductSilhouette() {
  return <div className="product-silhouette" aria-hidden="true"><span /><i /><b /></div>;
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
        <p className="eyebrow">How it works</p>
        <h2>Three simple moments after checkout.</h2>
      </div>
      <div className="steps-layout">
        <StepCard number="01" title="Buy normally" copy="Complete your purchase as usual." visual={<OrderMiniature />} />
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
  return <div className="protect-miniature" aria-hidden="true"><img src="/assets/tracer-logo.png" alt="" /><span>Bought it?</span><button type="button">Protect purchase</button></div>;
}

function OpportunityMiniature() {
  return <div className="opportunity-miniature" aria-hidden="true"><Bell size={21} /><p>£349.99 <span>-&gt;</span> £319.99</p><strong>£30 opportunity found</strong></div>;
}

function WatchingSection() {
  const capabilities = [
    { icon: <Tag aria-hidden="true" size={22} />, title: "Price drops", copy: "Tracer watches the product price after you protect a purchase." },
    { icon: <CalendarCheck2 aria-hidden="true" size={22} />, title: "Policy & eligibility windows", copy: "Known retailer windows are tracked where verified support exists." },
    { icon: <BadgeCheck aria-hidden="true" size={22} />, title: "Relevant claim opportunities", copy: "A price change is separated from something that may actually be worth acting on." },
    { icon: <Bell aria-hidden="true" size={22} />, title: "Alerts", copy: "Tracer tells you when a protected purchase needs your attention." },
  ];

  return (
    <section className="chapter watching-section">
      <div className="chapter-copy">
        <p className="eyebrow">What Tracer watches</p>
        <h2>We watch so you don't have to.</h2>
        <p>Once you protect a purchase, Tracer keeps an eye on the things that might matter after checkout.</p>
      </div>
      <div className="capability-panel">
        {capabilities.map((capability) => <article key={capability.title}><span>{capability.icon}</span><div><h3>{capability.title}</h3><p>{capability.copy}</p></div></article>)}
        <article className="coming-soon"><span><PackageCheck aria-hidden="true" size={22} /></span><div><h3>Return windows</h3><p>Coming soon. Designed as a separate protection layer after price monitoring.</p></div></article>
      </div>
    </section>
  );
}

function OpportunitySection() {
  return (
    <section className="chapter opportunity-section">
      <div className="opportunity-copy">
        <p className="eyebrow">The moment that matters</p>
        <h2>Not every price drop is a pay back.</h2>
        <p>When something changes, Tracer tells you whether there may actually be something worth doing.</p>
      </div>
      <article className="opportunity-card">
        <div className="opportunity-product"><ProductSilhouette /><div><span>Policy-backed opportunity</span><h3>Sony WH-1000XM5</h3></div></div>
        <div className="value-grid">
          <div><span>You paid</span><strong>£349.99</strong></div>
          <div><span>Current price</span><strong>£319.99</strong></div>
          <div className="saving"><span>Potential saving</span><strong>£30</strong></div>
        </div>
        <div className="eligibility-large"><span><Clock aria-hidden="true" size={18} />Eligibility</span><strong>4 days remaining</strong></div>
        <a className="primary-button" href="/dashboard">View opportunity<ExternalLink aria-hidden="true" size={17} /></a>
      </article>
    </section>
  );
}

function PrivacySection() {
  const trustItems = [
    { icon: <MailX aria-hidden="true" size={22} />, title: "No inbox access", copy: "Tracer does not need to read your email to find receipts." },
    { icon: <CreditCard aria-hidden="true" size={22} />, title: "No card details", copy: "Payment credentials and card numbers are outside Tracer's scope." },
    { icon: <ShieldCheck aria-hidden="true" size={22} />, title: "You choose what to save", copy: "Purchases are saved only when you press Protect." },
    { icon: <Database aria-hidden="true" size={22} />, title: "Structured data first", copy: "Tracer prefers the purchase details it needs over full-page storage." },
  ];

  return (
    <section className="chapter privacy-section" id="privacy">
      <div className="chapter-copy">
        <p className="eyebrow">Privacy</p>
        <h2>Only what Tracer needs. Nothing more.</h2>
        <p>Tracer observes checkout and order-confirmation pages, so the trust model has to be simple: minimal permissions, no inbox, no passwords, and no purchase saved unless you choose it.</p>
      </div>
      <div className="trust-card-grid">
        {trustItems.map((item) => <article key={item.title}><span>{item.icon}</span><h3>{item.title}</h3><p>{item.copy}</p></article>)}
      </div>
    </section>
  );
}

function StoreCoverageSection() {
  return (
    <section className="chapter store-coverage-section" id="support">
      <div className="section-heading">
        <p className="eyebrow">Store coverage</p>
        <h2>Made for shopping across the web.</h2>
        <p>Tracer uses broad purchase detection where possible, with enhanced retailer policy support added store by store.</p>
      </div>
      <div className="coverage-grid">
        <article><h3>Verified policy support</h3><p>Live retailer logic for identifying policy-backed opportunities.</p><LogoCloud shops={verifiedShopCards} /></article>
        <article><h3>Compatibility roadmap</h3><p>Planned and researched store coverage, clearly separated from verified policies.</p><LogoCloud shops={roadmapShopCards} /></article>
      </div>
    </section>
  );
}

function LogoCloud({ shops }: { shops: ShopCard[] }) {
  return <div className="logo-cloud">{shops.map((shop) => <div key={shop.name} aria-label={`${shop.name}: ${shop.status}`}><img src={shop.logoSrc} alt={`${shop.name} logo`} /></div>)}</div>;
}

function FinalCtaSection() {
  return (
    <section className="final-cta-section" id="install">
      <div>
        <img src="/assets/tracer-logo.png" alt="" />
        <p className="eyebrow">Install Tracer</p>
        <h2>Start protecting your purchases.</h2>
        <p>Add Tracer to Chrome and let it keep watching after you buy.</p>
        <a className="primary-button" href="/dashboard"><ChromeMark />Add to Chrome - It's free</a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer" id="faq">
      <a className="brand" href="/" aria-label="Tracer home">
        <img className="brand-logo" src="/assets/tracer-logo.png" alt="" />
        <img className="brand-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" />
      </a>
      <nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a><a href="#support">Support</a><a href="/dashboard">Dashboard</a></nav>
      <p>Your purchases don't end at checkout.</p>
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
