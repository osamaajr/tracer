(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let attempts = 0;

  function initialise() {
    const page = document.querySelector(".landing-shell-b");
    if (!page) {
      if (attempts++ < 120) window.requestAnimationFrame(initialise);
      return;
    }

    const heroElements = [
      ...page.querySelectorAll(".hero-copy > *"),
      ...page.querySelectorAll(".landing-b-card-scene > article"),
    ];
    const valueSection = page.querySelector(".landing-b-value");
    const valueHeading = valueSection?.querySelector("h2");
    const valueCopy = valueSection?.querySelector(".landing-b-watchlist-note");
    const valueVideo = valueSection?.querySelector(".landing-b-video-placeholder");
    const featureRows = [...page.querySelectorAll(".landing-b-editorial-feature")];
    const elements = [
      ...heroElements,
      ...[valueHeading, valueCopy, valueVideo].filter(Boolean),
      ...featureRows,
    ];
    const reveal = (element) => element?.classList.remove("scroll-reveal-pending");

    if (reducedMotion.matches || !("IntersectionObserver" in window)) {
      elements.forEach(reveal);
      return;
    }

    const revealThreshold = window.innerWidth >= 760 ? 0.32 : 0.22;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (entry.target === valueSection) {
          reveal(valueHeading);
          reveal(valueCopy);
          reveal(valueVideo);
        } else {
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
      [valueHeading, valueCopy, valueVideo].forEach((element) => {
        if (!element) return;
        element.classList.add("scroll-reveal", "scroll-reveal-pending");
      });
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

    reducedMotion.addEventListener("change", () => {
      if (!reducedMotion.matches) return;
      observer.disconnect();
      elements.forEach(reveal);
    }, { once: true });

    page.addEventListener("focusin", (event) => {
      const element = event.target instanceof Element
        ? event.target.closest(".scroll-reveal-pending")
        : null;
      if (element) {
        reveal(element);
        observer.unobserve(element);
      }
    });
  }

  initialise();
})();
