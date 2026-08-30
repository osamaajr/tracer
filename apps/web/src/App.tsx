import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  MousePointerClick,
  Play,
  RefreshCw,
  Sparkles,
  Star,
  TimerReset,
  WalletCards,
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
      productName:
        "Sony WH-1000XM6 Wireless Bluetooth Noise Cancelling Headphones",
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
      claimUrl:
        "https://www.johnlewis.com/customer-services/prices-and-payment/price-promise/request",
      guidance:
        "This may qualify under John Lewis Price Promise if the item is identical, in stock, and not excluded.",
      status: "open",
    },
  ],
};

const shopCards: ShopCard[] = [
  {
    name: "John Lewis",
    status: "policy live",
    logoSrc: "/assets/store-john-lewis.png",
  },
  {
    name: "Argos",
    status: "policy planned",
    logoSrc: "/assets/store-argos.svg",
  },
  {
    name: "Shopify",
    status: "coming soon",
    logoSrc: "/assets/store-shopify.svg",
  },
  {
    name: "WooCommerce",
    status: "coming soon",
    logoSrc: "/assets/store-woocommerce.svg",
  },
  {
    name: "Amazon",
    status: "policy pending",
    logoSrc: "/assets/store-amazon.png",
  },
  {
    name: "ASOS",
    status: "policy planned",
    logoSrc: "/assets/store-asos.svg",
  },
  {
    name: "Boots",
    status: "policy planned",
    logoSrc: "/assets/store-boots.svg",
  },
  {
    name: "Apple",
    status: "policy pending",
    logoSrc: "/assets/store-apple.png",
  },
  {
    name: "Currys",
    status: "policy pending",
    logoSrc: "/assets/store-currys.png",
  },
  {
    name: "eBay",
    status: "policy planned",
    logoSrc: "/assets/store-ebay.svg",
  },
  {
    name: "IKEA",
    status: "policy planned",
    logoSrc: "/assets/store-ikea.svg",
  },
  {
    name: "Nike",
    status: "policy planned",
    logoSrc: "/assets/store-nike.svg",
  },
  {
    name: "Adidas",
    status: "policy planned",
    logoSrc: "/assets/store-adidas.svg",
  },
  {
    name: "Zara",
    status: "policy planned",
    logoSrc: "/assets/store-zara.svg",
  },
  {
    name: "Next",
    status: "policy planned",
    logoSrc: "/assets/store-next.svg",
  },
  {
    name: "Tesco",
    status: "policy planned",
    logoSrc: "/assets/store-tesco.svg",
  },
  {
    name: "H&M",
    status: "policy planned",
    logoSrc: "/assets/store-hm.svg",
  },
  {
    name: "M&S",
    status: "policy planned",
    logoSrc: "/assets/store-ms.svg",
  },
];
const leaderboardRows = [
  ["John Lewis", "14 protected", "£312 watched"],
  ["Any HTTPS Store", "8 protected", "£97 watched"],
  ["Shopify", "5 protected", "adapter planned"],
];
const reviewCards = [
  {
    quote:
      "Tracer caught the price change before I had even thought to check again.",
    name: "Beta shopper",
    meta: "Placeholder testimonial",
  },
  {
    quote:
      "The useful bit is that it separates a real policy claim from a normal price drop.",
    name: "Early tester",
    meta: "Placeholder testimonial",
  },
  {
    quote:
      "It feels like the receipt finally does something after checkout.",
    name: "Chrome user",
    meta: "Chrome Web Store placeholder",
  },
];

export function App() {
  const isDashboard = window.location.pathname.startsWith("/dashboard");

  return isDashboard ? <Dashboard /> : <LandingPage />;
}

function LandingPage() {
  return (
    <main className="landing-shell">
      <Header />

      <section className="hero">
        <div className="hero-copy">
          <h1>Bought it? Tracer finds the pay back.</h1>
          <p className="hero-text">
            Scan any order page, track the price after checkout, and get a clear
            alert when a verified store policy could put money back in your pocket.
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" disabled>
              <Download aria-hidden="true" size={18} />
              Add to Chrome
            </button>
            <a className="secondary-button" href="#demo">
              <Play aria-hidden="true" size={17} />
              See demo
            </a>
          </div>
        </div>

        <div className="hero-stage">
          <PaybackCard />
        </div>
      </section>

      <ShopCarousel />

      <section className="demo-section" id="demo">
        <div className="section-copy">
          <p className="eyebrow">How it works</p>
          <h2>Three steps after checkout.</h2>
        </div>
        <div className="step-grid">
          <article>
            <div className="step-asset">
              <MousePointerClick aria-hidden="true" size={25} />
            </div>
            <h3>Scan the order</h3>
            <p>Tracer reads reliable receipt data from the current store page.</p>
          </article>
          <article>
            <div className="step-asset">
              <Clock aria-hidden="true" size={25} />
            </div>
            <h3>Watch the price</h3>
            <p>It keeps the product URL and checks against what you paid.</p>
          </article>
          <article>
            <div className="step-asset">
              <WalletCards aria-hidden="true" size={25} />
            </div>
            <h3>Catch the pay back</h3>
            <p>Verified policies turn qualifying drops into clear next steps.</p>
          </article>
        </div>
      </section>

      <section className="video-section">
        <div className="video-placeholder">
          <button type="button" aria-label="Demo video placeholder">
            <Play aria-hidden="true" size={42} />
          </button>
          <span>Demo video placeholder</span>
        </div>
      </section>

      <section className="leaderboard-section" id="leaderboard">
        <p className="eyebrow">Live map placeholder</p>
        <h2>See what shoppers are protecting.</h2>
        <p>Community stats for launch, shown here with placeholder data.</p>
        <div className="leaderboard-list">
          {leaderboardRows.map(([store, count, value], index) => (
            <div className="leaderboard-row" key={store}>
              <span>{index + 1}</span>
              <strong>{store}</strong>
              <p>{count}</p>
              <em>{value}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="review-section" id="reviews">
        <div className="rating-card">
          <strong>5.0</strong>
          <span>
            <Star aria-hidden="true" size={17} />
            Chrome Web Store rating placeholder
          </span>
        </div>
        <div className="review-grid">
          {reviewCards.map((review) => (
            <article key={review.name}>
              <p>&ldquo;{review.quote}&rdquo;</p>
              <div>
                <strong>{review.name}</strong>
                <span>{review.meta}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="pricing-section" id="pricing">
        <p className="eyebrow">Pricing</p>
        <h2>Free while the pay back map grows.</h2>
        <div className="pricing-card">
          <span>Beta price placeholder</span>
          <strong>£0</strong>
          <p>
            Payments are not wired yet. This is the launch-ready card for the
            public Chrome listing once billing is decided.
          </p>
          <ul>
            <li>
              <CheckCircle2 aria-hidden="true" size={17} />
              Any-store order capture
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" size={17} />
              John Lewis policy adapter
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" size={17} />
              Price-drop dashboard
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" size={17} />
              More stores marked as placeholders
            </li>
          </ul>
          <button className="primary-button" type="button" disabled>
            Get Started
          </button>
        </div>
      </section>

      <footer className="site-footer">
        <a className="brand" href="/" aria-label="Tracer home">
          <img className="brand-logo" src="/assets/tracer-logo.png" alt="" />
          <img className="brand-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" />
        </a>
        <nav aria-label="Footer navigation">
          <a href="/dashboard">Dashboard</a>
          <a href="#pricing">Pricing</a>
          <a href="#shops">Stores</a>
        </nav>
      </footer>
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
        <a href="#shops">Stores</a>
        <a href="#demo">How it works</a>
        <a href="#reviews">Reviews</a>
        <a href="#pricing">Pricing</a>
      </nav>
      <a className="header-cta" href="/dashboard">
        Dashboard
      </a>
    </header>
  );
}

function PaybackCard() {
  return (
    <div className="payback-orbit" aria-label="Tracer extension pay back preview">
      <article className="payback-card">
        <div className="extension-topbar">
          <div>
            <img className="mini-logo" src="/assets/tracer-logo.png" alt="" />
            <img
              className="extension-wordmark"
              src="/assets/tracer-wordmark.png"
              alt="Tracer"
            />
          </div>
          <span className="status-pill">Detected</span>
        </div>

        <div className="payback-alert">
          <div className="alert-icon">
            <Sparkles aria-hidden="true" size={20} />
          </div>
          <div>
            <p>Pay back detected</p>
            <h2>£30 may be claimable</h2>
          </div>
        </div>

        <div className="purchase-card">
          <div className="store-line">
            <div className="store-mark">JL</div>
            <div>
              <span>John Lewis</span>
              <strong>Sony WH-1000XM6</strong>
            </div>
          </div>
          <div className="price-grid">
            <div>
              <span>You paid</span>
              <strong>£349</strong>
            </div>
            <div>
              <span>Now</span>
              <strong>£319</strong>
            </div>
          </div>
        </div>

        <div className="scan-panel">
          <span>Checking policy window</span>
          <div className="scan-line">
            <i />
          </div>
          <p>Price Promise route found</p>
        </div>

        <a className="claim-preview" href="/dashboard">
          Open claim steps
          <ExternalLink aria-hidden="true" size={15} />
        </a>
      </article>
    </div>
  );
}

function ShopCarousel() {
  const repeatedCards = [...shopCards, ...shopCards];

  return (
    <section className="shop-section" id="shops" aria-label="Supported stores">
      <p className="eyebrow">Supported shops</p>
      <h2>Capture everywhere. Claim where policies are verified.</h2>
      <div className="shop-marquee">
        <div className="shop-track">
          {repeatedCards.map((shop, index) => (
            <article
              aria-label={`${shop.name}: ${shop.status}`}
              className="shop-card"
              key={`${shop.name}-${index}`}
            >
              <img src={shop.logoSrc} alt={`${shop.name} logo`} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Dashboard() {
  const [dashboard, setDashboard] = useState<DashboardData>(demoDashboard);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "offline">(
    "idle",
  );
  const [actingOpportunityId, setActingOpportunityId] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setStatus("loading");

    try {
      const response = await fetch(`${apiBaseUrl}/api/dashboard`, {
        headers: { "x-afterbuy-user-id": demoUserId },
      });

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

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const runMonitoring = useCallback(async () => {
    setStatus("loading");

    try {
      await fetch(`${apiBaseUrl}/api/dev/run-monitoring`, {
        method: "POST",
        headers: { "x-afterbuy-user-id": demoUserId },
      });
      await fetchDashboard();
    } catch {
      setStatus("offline");
    }
  }, [fetchDashboard]);

  const updateOpportunity = useCallback(
    async (
      opportunityId: string,
      action: "viewed" | "claim-clicked" | "dismiss",
    ) => {
      setActingOpportunityId(opportunityId);

      try {
        const response = await fetch(
          `${apiBaseUrl}/api/opportunities/${opportunityId}/${action}`,
          {
            method: "POST",
            headers: { "x-afterbuy-user-id": demoUserId },
          },
        );

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
    },
    [fetchDashboard],
  );

  const claimOpportunity = useCallback(
    async (opportunity: DashboardOpportunity) => {
      const updated = await updateOpportunity(opportunity.id, "claim-clicked");

      if (updated) {
        window.open(opportunity.claimUrl, "_blank", "noopener,noreferrer");
      }
    },
    [updateOpportunity],
  );

  const openOpportunity = useMemo(
    () =>
      dashboard.opportunities.find((opportunity) =>
        isActionableOpportunityStatus(opportunity.status),
      ),
    [dashboard.opportunities],
  );

  const activeOpportunityCount = useMemo(
    () =>
      dashboard.opportunities.filter((opportunity) =>
        isActionableOpportunityStatus(opportunity.status),
      ).length,
    [dashboard.opportunities],
  );

  const uniqueStoreCount = useMemo(
    () => new Set(dashboard.purchases.map((purchase) => retailerName(purchase))).size,
    [dashboard.purchases],
  );

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <a className="brand" href="/" aria-label="Tracer home">
          <img className="brand-logo" src="/assets/tracer-logo.png" alt="" />
          <img className="brand-wordmark" src="/assets/tracer-wordmark.png" alt="Tracer" />
        </a>
        <div className="dashboard-actions">
          <span className={`status-dot ${status}`}>{statusLabel(status)}</span>
          <button className="icon-button" type="button" onClick={fetchDashboard}>
            <RefreshCw aria-hidden="true" size={16} />
            Refresh
          </button>
          <button className="icon-button dark" type="button" onClick={runMonitoring}>
            <TimerReset aria-hidden="true" size={16} />
            Run monitor
          </button>
        </div>
      </header>

      <section className="dashboard-summary">
        <div>
          <p className="eyebrow">Protected purchases</p>
          <h1>{dashboard.purchases.length}</h1>
        </div>
        <div>
          <p className="eyebrow">Open opportunities</p>
          <h1>{activeOpportunityCount}</h1>
        </div>
        <div>
          <p className="eyebrow">Stores watched</p>
          <h1>{uniqueStoreCount}</h1>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="table-panel">
          <div className="panel-heading">
            <h2>Purchases</h2>
            <span>Any-store capture</span>
          </div>
          <div className="purchase-list">
            {dashboard.purchases.map((purchase) => (
              <article className="purchase-row" key={purchase.id}>
                <div>
                  <h3>{purchase.productName}</h3>
                  <p>
                    {retailerName(purchase)} / {purchase.storeHost ?? purchase.retailerId} /
                    purchased {formatDate(purchase.purchasedAt)}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Paid</dt>
                    <dd>{purchase.pricePaidDisplay}</dd>
                  </div>
                  <div>
                    <dt>Current</dt>
                    <dd>{purchase.currentPriceDisplay ?? "Waiting"}</dd>
                  </div>
                  <div>
                    <dt>Capture</dt>
                    <dd>{captureLabel(purchase)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>

        <aside className="opportunity-panel">
          <div className="panel-heading">
            <h2>Opportunity</h2>
            <Bell aria-hidden="true" size={18} />
          </div>
          {openOpportunity ? (
            <article className="dashboard-opportunity">
              <p className="retailer-label">Policy-backed claim</p>
              <h3>{openOpportunity.title}</h3>
              <dl>
                <div>
                  <dt>You paid</dt>
                  <dd>{openOpportunity.originalPriceDisplay}</dd>
                </div>
                <div>
                  <dt>Now</dt>
                  <dd>{openOpportunity.currentPriceDisplay}</dd>
                </div>
                <div>
                  <dt>Claim by</dt>
                  <dd>{formatDate(openOpportunity.claimBy)}</dd>
                </div>
              </dl>
              <p>{openOpportunity.guidance}</p>
              <div className="opportunity-actions">
                <button
                  className="claim-button"
                  type="button"
                  disabled={actingOpportunityId === openOpportunity.id}
                  onClick={() => void claimOpportunity(openOpportunity)}
                >
                  Claim {openOpportunity.potentialSavingDisplay}
                  <ExternalLink aria-hidden="true" size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={actingOpportunityId === openOpportunity.id}
                  onClick={() =>
                    void updateOpportunity(openOpportunity.id, "dismiss")
                  }
                >
                  Dismiss
                </button>
              </div>
            </article>
          ) : (
            <p className="empty-state">
              No policy-backed opportunity yet. Generic stores can still be
              watched while retailer policies are added.
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}

function statusLabel(status: "idle" | "loading" | "ready" | "offline"): string {
  if (status === "loading") {
    return "Loading";
  }

  if (status === "ready") {
    return "API connected";
  }

  if (status === "offline") {
    return "Demo data";
  }

  return "Ready";
}

function retailerName(purchase: DashboardPurchase): string {
  return purchase.retailerName ?? (purchase.retailerId === "john-lewis" ? "John Lewis" : purchase.retailerId);
}

function captureLabel(purchase: DashboardPurchase): string {
  if (purchase.captureConfidence) {
    return purchase.captureConfidence;
  }

  if (purchase.retailerId === "john-lewis") {
    return "high";
  }

  return "tracked";
}

function isActionableOpportunityStatus(status: string): boolean {
  return status === "open" || status === "viewed";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}
