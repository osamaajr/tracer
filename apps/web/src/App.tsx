import "./landing-b.css";
import landingWordmark from "./assets/landing-b/tracer-wordmark-outline-transparent.webp";
import productHeadphones from "./assets/product-headphones.webp?inline";
import productDeskLamp from "./assets/products/desk-lamp.webp?inline";
import productDaypack from "./assets/products/daypack.webp?inline";
import productEspressoMachine from "./assets/products/espresso-machine.webp?inline";
import productRunningTrainers from "./assets/products/running-trainers.webp?inline";
import storeAmazon from "./assets/retailers/store-amazon.png";
import storeApple from "./assets/retailers/store-apple.png";
import storeArgos from "./assets/retailers/store-argos.svg";
import storeAsos from "./assets/retailers/store-asos.svg";
import storeCurrys from "./assets/retailers/store-currys.png";
import storeJohnLewis from "./assets/retailers/store-john-lewis.png";
import storeNike from "./assets/retailers/store-nike.svg";
import tracerLogo from "./assets/tracer-logo.png";
import tracerWordmark from "./assets/tracer-wordmark.png";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { initializeScrollReveal } from "./scroll-reveal";
import {
  ArrowDown,
  ArrowRight,
  Bookmark,
  CalendarClock,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Globe2,
  MoreHorizontal,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  X,
} from "lucide-react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const demoUserId = "dev-user-tracer";

interface DashboardPurchase {
  id: string;
  retailerId: string;
  retailerName?: string;
  storeHost?: string;
  productName: string;
  productUrl?: string;
  imageUrl?: string;
  pricePaidDisplay: string;
  orderTotalPaidDisplay?: string | null;
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

  useLayoutEffect(() => {
    const page = document.querySelector<HTMLElement>(".landing-shell-b");
    if (!page) return;
    return initializeScrollReveal(page);
  }, []);

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
      <Footer landingB />
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
          <img src={landingWordmark} alt="Tracer" width={592} height={195} />
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
            <div className="landing-b-save-card">
              <header>
                <span className="landing-b-save-mark"><Bookmark aria-hidden="true" size={20} /></span>
                <div><strong>Saved items</strong><p>Your finds. One happy place.</p></div>
                <span className="landing-b-save-count">12 items</span>
              </header>
              <div className="landing-b-save-products">
                <div className="landing-b-save-product">
                  <div className="landing-b-save-thumbnail landing-b-save-thumbnail-blue"><img src={productHeadphones} alt="Black wireless headphones" width={400} height={400} loading="lazy" decoding="async" /></div>
                  <strong>Headphones</strong><span>£349.99</span>
                </div>
                <div className="landing-b-save-product">
                  <div className="landing-b-save-thumbnail landing-b-save-thumbnail-sand"><img src={productDeskLamp} alt="Ivory adjustable desk lamp" width={400} height={400} loading="lazy" decoding="async" /></div>
                  <strong>Desk lamp</strong><span>£48.00</span>
                </div>
                <div className="landing-b-save-product">
                  <div className="landing-b-save-thumbnail landing-b-save-thumbnail-green"><img src={productDaypack} alt="Sage green canvas daypack" width={400} height={400} loading="lazy" decoding="async" /></div>
                  <strong>Daypack</strong><span>£84.50</span>
                </div>
              </div>
              <footer><span className="landing-b-save-watching"><i aria-hidden="true" />Watching for price drops</span><span>From any shop <Globe2 aria-hidden="true" size={13} /></span></footer>
            </div>
          </div>
        </article>

        <article className="landing-b-editorial-feature landing-b-editorial-feature-reversed">
          <div className="landing-b-editorial-copy">
            <h3>We watch the price for you.</h3>
            <p>Tracer keeps checking saved and purchased items, then lets you know when the price drops.</p>
          </div>
          <div className="landing-b-feature-visual landing-b-drop-visual" aria-label="Tracer price-drop notification example">
            <div className="landing-b-feature-alert">
              <header className="landing-b-drop-header">
                <span className="landing-b-feature-alert-icon"><ArrowDown aria-hidden="true" size={18} /></span>
                <strong>Price drop detected</strong>
                <time>Just now</time>
              </header>
              <div className="landing-b-drop-product">
                <span className="landing-b-drop-product-icon"><img src={productEspressoMachine} alt="Cream and steel espresso machine" width={400} height={400} loading="lazy" decoding="async" /></span>
                <div><span>Currys</span><strong>Compact espresso machine</strong><p>Brushed steel · Cream</p></div>
              </div>
              <div className="landing-b-feature-price-row">
                <span><small>Previous price</small><s>£199.00</s></span>
                <ArrowRight aria-hidden="true" size={18} />
                <span><small>Now</small><strong>£169.00</strong></span>
              </div>
              <footer className="landing-b-drop-footer"><span><CheckCircle2 aria-hidden="true" size={13} />Still watching the price</span><em>£30 less</em></footer>
            </div>
          </div>
        </article>

        <article className="landing-b-editorial-feature">
          <div className="landing-b-editorial-copy">
            <h3>Only hear about what matters.</h3>
            <p>Get a heads-up when a price drops or a return window is about to close.</p>
          </div>
          <div className="landing-b-feature-visual landing-b-update-visual" aria-label="Tracer activity alert example">
            <div className="landing-b-update-card">
              <header>
                <span><CalendarClock aria-hidden="true" size={20} /></span>
                <div><strong>Return reminder</strong><p>There’s still time to decide.</p></div>
                <time>Now</time>
              </header>
              <div className="landing-b-update-detail">
                <span><RotateCcw aria-hidden="true" size={21} /></span>
                <div><strong>Return window ending</strong><p>Review your order while you still can.</p></div>
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
                <span className="landing-b-monitor-product-icon"><img src={productRunningTrainers} alt="Coral running trainers" width={400} height={400} loading="lazy" decoding="async" /></span>
                <div><strong>Everyday running trainers</strong><p>ASOS</p></div>
              </div>
              <dl>
                <div><dt>Paid</dt><dd>£120.00</dd></div>
                <div><dt>Current price</dt><dd>£120.00</dd></div>
              </dl>
              <footer><span><CheckCircle2 aria-hidden="true" size={15} /> Watching for drops</span><small><Clock3 aria-hidden="true" size={13} /> Checked just now</small></footer>
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

function Footer({ landingB = false }: { landingB?: boolean }) {
  return (
    <footer className="site-footer" id="faq">
      <div className="footer-clouds" aria-hidden="true"><span /><span /></div>
      <div className="footer-row">
        <a className="brand" href="/" aria-label="Tracer home">
          {!landingB && <>
            <img className="brand-logo" src={tracerLogo} alt="" width={874} height={755} />
            <img className="brand-wordmark" src={tracerWordmark} alt="Tracer" width={1126} height={283} />
          </>}
        </a>
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
    <SitePage title="Privacy Policy" description="How Tracer handles product, purchase, and settings data.">
      <article className="policy-document">
        <PolicySection title="About this policy">
          <p>Last updated 22 September 2026. This policy explains how Tracer handles information when you visit this website or use the Tracer Chrome extension. Tracer is operated by the person or business identified through <a href="mailto:osama.alnajar.26@gmail.com">osama.alnajar.26@gmail.com</a> (“Tracer”, “we”, “us”).</p>
          <p>Where data-protection law applies, we act as the controller for the personal data described here. This policy reflects the current product and will be updated if that changes.</p>
        </PolicySection>

        <PolicySection title="Information the extension reads">
          <p>When the extension runs on a supported shopping or order page, it reads the page details needed for the feature you request. Depending on what the page exposes, this can include product name, retailer, URLs, product image, price, currency, quantity, purchase date, order reference, product identifier, or SKU.</p>
          <p>It may also read a current price and availability from a public product page for an item being watched. It does not read your email inbox, payment-card numbers, or passwords. It uses matching shopping and order pages to identify a product or purchase, rather than collecting unrelated browsing content.</p>
        </PolicySection>

        <PolicySection title="What is stored locally" emphasis>
          <p>Saved items are stored in Chrome extension storage on your device. This can include the item name, retailer, canonical product URL, saved price, image URL, product identifiers, save time, current price, last-check time, monitoring status, and notification state. The extension also stores settings such as whether monitoring and price-drop alerts are enabled, plus a local pseudonymous Tracer identifier used to associate protected purchases with the API.</p>
          <p>You can remove saved items, clear protected purchases, and turn monitoring or alerts off through the extension. Chrome controls extension storage and may remove it when you uninstall the extension.</p>
        </PolicySection>

        <PolicySection title="What is sent to the API">
          <p>When you choose to protect a purchase, the extension sends the captured purchase and product information needed to create and monitor that protection. The API stores purchase records, product details, price observations, monitoring preferences, opportunities, and activity events so Tracer can show protected items and notify you about relevant price changes.</p>
          <p>Saved watchlist items are primarily managed locally. The extension may visit a saved product page in a background tab to read a current price; the resulting price and monitoring status stay in extension storage unless you later protect that purchase.</p>
        </PolicySection>

        <PolicySection title="How we use information">
          <ul>
            <li>To save products, protect purchases, check prices, and show monitoring results.</li>
            <li>To send browser notifications about relevant price drops when alerts are enabled.</li>
            <li>To connect a saved item to a protected purchase when details match.</li>
            <li>To secure, troubleshoot, maintain, and improve Tracer and prevent misuse.</li>
          </ul>
          <p>We do not sell Tracer data, build advertising profiles, or use it to provide personalised ads.</p>
        </PolicySection>

        <PolicySection title="Lawful bases">
          <p>Where the UK GDPR or similar law applies, we generally process information because it is necessary to provide a feature you ask us to use, because we have a legitimate interest in operating and securing Tracer, or because you have given consent where consent is required.</p>
        </PolicySection>

        <PolicySection title="Retailers and service providers">
          <p>Tracer checks public product pages and information displayed by the retailer whose order page you use. Retailers remain responsible for their own sites and privacy practices. Hosting, storage, monitoring, and notification providers may process information needed to operate Tracer. We do not sell personal information or share it for advertising; disclosures may occur when required by law, for security, or as part of a business transfer.</p>
        </PolicySection>

        <PolicySection title="International transfers and security">
          <p>Service providers may process information outside the UK or European Economic Area. Where applicable, we will use a lawful transfer mechanism and appropriate safeguards. Tracer uses HTTPS for network requests and access controls in the API, but no browser or internet service can guarantee absolute security.</p>
        </PolicySection>

        <PolicySection title="Retention and deletion">
          <p>Local saved-item and settings data remains until you remove it, clear it through the extension, uninstall the extension, or it is overwritten by Chrome. Protected-purchase records, observations, and related activity remain in the API while needed to provide monitoring and maintain service records. Deleting a protected purchase removes it and its related opportunities and activity, subject to backups, security records, legal obligations, and technical limits.</p>
          <p>Server logs and operational records are kept only as long as reasonably necessary for security, reliability, and legal purposes.</p>
        </PolicySection>

        <PolicySection title="Your rights">
          <p>Depending on where you live and the applicable law, you may have rights to access, correct, delete, restrict, or object to processing of your personal data, and to receive portable data. You may also complain to your local data-protection authority. To make a request, email <a href="mailto:osama.alnajar.26@gmail.com">osama.alnajar.26@gmail.com</a>; we may need enough information to verify and locate the relevant data.</p>
        </PolicySection>

        <PolicySection title="Changes to this policy">
          <p>We may update this policy as Tracer evolves. The latest version and update date will be published on this page.</p>
        </PolicySection>

        <PolicySection title="Contact">
          <p>Privacy questions and requests can be sent to <a href="mailto:osama.alnajar.26@gmail.com">osama.alnajar.26@gmail.com</a>.</p>
        </PolicySection>
      </article>
    </SitePage>
  );
}

function TermsPage() {
  return (
    <SitePage title="Terms of Service" description="The terms that apply when you use Tracer.">
      <article className="policy-document">
        <PolicySection title="Agreement">
          <p>Last updated 22 September 2026. By visiting the Tracer website or installing or using the extension, you agree to these terms. If you do not agree, do not use Tracer.</p>
        </PolicySection>

        <PolicySection title="What Tracer does">
          <p>Tracer lets you save products from shopping sites, protect selected purchases after checkout, monitor available product prices, and receive alerts about relevant price changes or purchase opportunities. The extension reads information shown on supported shopping and order pages and may check public product pages in the background for saved or protected items.</p>
          <p>Tracer does not buy products, submit retailer claims, change retailer orders, guarantee refunds, or act as your agent. Any action with a retailer is your responsibility.</p>
        </PolicySection>

        <PolicySection title="Your data and access">
          <p>The current version does not require a user account or email sign-in. The extension uses a local pseudonymous identifier to associate protected purchases with the API. You are responsible for keeping access to your browser and extension profile secure and for checking captured information before protecting a purchase.</p>
        </PolicySection>

        <PolicySection title="Acceptable use">
          <p>You must use Tracer lawfully and must not misuse, probe, disrupt, overload, reverse engineer, or attempt to gain unauthorised access to Tracer, its API, or another user’s data. You must not use automated requests or captured information to violate a retailer’s terms, access controls, or applicable law.</p>
        </PolicySection>

        <PolicySection title="Accuracy and retailer limitations" emphasis>
          <p>Tracer depends on retailer pages, public information, network access, page structure, and monitoring rules that can change without notice. Prices, availability, images, order details, dates, and policy information may be missing, delayed, incorrect, or unavailable. Monitoring may fail or pause, and a notification is not proof that a refund, price adjustment, or other retailer remedy is available.</p>
          <p>Always verify current details and the retailer’s terms before making a purchase, contacting a retailer, or relying on an alert.</p>
        </PolicySection>

        <PolicySection title="Third-party sites and services">
          <p>Tracer links to or reads third-party retailer sites but does not control them. Your use of those sites is governed by their terms and privacy notices. Tracer is not responsible for their content, availability, security, prices, policies, or decisions.</p>
        </PolicySection>

        <PolicySection title="Intellectual property">
          <p>Tracer, its name, logo, software, website, design, and original content belong to Tracer or its licensors. We grant you a limited, revocable, non-transferable licence to use the extension and website for their intended purpose. Retailer names, product images, and other third-party material remain owned by their respective owners.</p>
        </PolicySection>

        <PolicySection title="Availability and changes">
          <p>Tracer is provided on an “as available” basis. We may update, modify, suspend, or discontinue the website, extension, monitoring coverage, or any feature, including to maintain security or comply with law. We do not promise uninterrupted or error-free service. We will not reduce your rights under mandatory consumer law.</p>
        </PolicySection>

        <PolicySection title="Disclaimers and liability">
          <p>To the extent permitted by law, Tracer is not responsible for indirect or consequential loss, missed savings, retailer decisions, unavailable pages, or information you choose to rely on. Nothing in these terms excludes or limits liability that cannot legally be excluded, including liability for fraud or for death or personal injury caused by negligence. If Tracer is supplied to a consumer, your statutory consumer rights remain unaffected.</p>
        </PolicySection>

        <PolicySection title="Suspension and termination">
          <p>We may suspend or terminate access where reasonably necessary to protect the service, investigate misuse, comply with law, or respond to a security risk. You can stop using Tracer and uninstall the extension at any time. Ending use does not remove data automatically; use the available deletion controls or contact us.</p>
        </PolicySection>

        <PolicySection title="Changes to these terms">
          <p>We may update these terms as Tracer changes. We will publish the latest version and update the date above. If a change materially affects your rights, we will take reasonable steps to draw it to your attention.</p>
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
      const response = await fetch(`${apiBaseUrl}/api/dashboard`, { headers: { "x-tracer-user-id": demoUserId } });
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
          <img className="brand-logo" src={tracerLogo} alt="" width={874} height={755} />
          <img className="brand-wordmark" src={tracerWordmark} alt="Tracer" width={1126} height={283} />
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
            <div><dt>{purchase.orderTotalPaidDisplay ? "Order total paid" : "Item price"}</dt><dd>{purchase.orderTotalPaidDisplay ?? purchase.pricePaidDisplay}</dd></div>
            <div><dt>Current item price</dt><dd>{purchase.currentPriceDisplay ?? "Not checked yet"}</dd></div>
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
    amazon: storeAmazon,
    apple: storeApple,
    argos: storeArgos,
    asos: storeAsos,
    currys: storeCurrys,
    "john-lewis": storeJohnLewis,
    nike: storeNike,
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
