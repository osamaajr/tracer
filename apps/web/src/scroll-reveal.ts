export function initializeScrollReveal(page: HTMLElement): () => void {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const heroElements = [
    ...page.querySelectorAll<HTMLElement>(".hero-copy > *"),
    ...page.querySelectorAll<HTMLElement>(".landing-b-card-scene > article"),
  ];
  const valueSection = page.querySelector<HTMLElement>(".landing-b-value");
  const valueHeading = valueSection?.querySelector<HTMLElement>("h2") ?? null;
  const valueCopy = valueSection?.querySelector<HTMLElement>(".landing-b-watchlist-note") ?? null;
  const valueVideo = valueSection?.querySelector<HTMLElement>(".landing-b-video-placeholder") ?? null;
  const featureRows = [...page.querySelectorAll<HTMLElement>(".landing-b-editorial-feature")];
  const valueElements = [valueHeading, valueCopy, valueVideo].filter(
    (element): element is HTMLElement => element !== null,
  );
  const elements = [...heroElements, ...valueElements, ...featureRows];
  const reveal = (element: HTMLElement | null | undefined) => element?.classList.remove("scroll-reveal-pending");

  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    elements.forEach(reveal);
    return () => {};
  }

  const revealThreshold = window.innerWidth >= 760 ? 0.32 : 0.22;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      if (entry.target === valueSection) {
        valueElements.forEach(reveal);
      } else if (entry.target instanceof HTMLElement) {
        reveal(entry.target);
      }
      observer.unobserve(entry.target);
    });
  }, { threshold: revealThreshold, rootMargin: "0px 0px -1% 0px" });

  heroElements.forEach((element, index) => {
    element.style.setProperty("--reveal-delay", `${Math.min(index, 3) * 80}ms`);
    element.classList.add("scroll-reveal", "scroll-reveal-pending");
    observer.observe(element);
  });

  if (valueSection) {
    valueElements.forEach((element) => element.classList.add("scroll-reveal", "scroll-reveal-pending"));
    valueHeading?.style.setProperty("--reveal-delay", "0ms");
    valueCopy?.style.setProperty("--reveal-delay", "100ms");
    valueVideo?.style.setProperty("--reveal-delay", "200ms");
    observer.observe(valueSection);
  }

  featureRows.forEach((row) => {
    // Reveal the copy, supporting text, and card as one composed feature moment.
    row.style.setProperty("--reveal-delay", "0ms");
    row.classList.add("scroll-reveal", "scroll-reveal-pending");
    observer.observe(row);
  });

  const onMotionChange = () => {
    if (!reducedMotion.matches) return;
    observer.disconnect();
    elements.forEach(reveal);
  };
  const onFocusIn = (event: FocusEvent) => {
    const element = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".scroll-reveal-pending")
      : null;
    if (element) {
      reveal(element);
      observer.unobserve(element);
    }
  };

  reducedMotion.addEventListener("change", onMotionChange, { once: true });
  page.addEventListener("focusin", onFocusIn);

  return () => {
    observer.disconnect();
    reducedMotion.removeEventListener("change", onMotionChange);
    page.removeEventListener("focusin", onFocusIn);
  };
}
