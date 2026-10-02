import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  extractSavedProduct,
  findProductPageImage,
  findProductPageImages,
  selectProductImage,
} from "../index";

const baseUrl = "https://shop.example.com/products/aurora-lamp";

describe("smart product image selection", () => {
  it("prefers structured product imagery over a generic Open Graph preview", () => {
    const selected = selectProductImage([
      {
        value: { contentUrl: "/images/aurora-lamp.jpg", width: 600, height: 600 },
        source: "json_ld",
      },
      {
        value: "/social/store-preview.jpg",
        source: "open_graph",
        width: 1200,
        height: 630,
      },
    ], baseUrl, "Aurora Glass Lamp");

    expect(selected).toEqual({
      url: "https://shop.example.com/images/aurora-lamp.jpg",
      source: "json_ld",
    });
  });

  it("selects an image from the main product gallery", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Aurora Glass Lamp</h1>
        <div class="product-gallery">
          <img src="/images/aurora-lamp-main.jpg" width="720" height="720" alt="Aurora Glass Lamp">
        </div>
      </main>
    `);

    expect(findProductPageImage(document, baseUrl, { productName: "Aurora Glass Lamp" })).toEqual({
      url: "https://shop.example.com/images/aurora-lamp-main.jpg",
      source: "gallery",
    });
  });

  it("returns a ranked, deduplicated gallery shortlist for manual selection", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Aurora Glass Lamp</h1>
        <div class="product-gallery">
          <img src="/images/aurora-lamp-front.jpg" width="900" height="900" alt="Aurora Glass Lamp product front">
          <img src="/images/aurora-lamp-side.jpg" width="900" height="900" alt="Aurora Glass Lamp side">
          <img src="/images/aurora-lamp-front.jpg" width="900" height="900" alt="Aurora Glass Lamp product front">
        </div>
      </main>
    `);

    expect(findProductPageImages(document, baseUrl, { productName: "Aurora Glass Lamp" }).map(({ url }) => url))
      .toEqual([
        "https://shop.example.com/images/aurora-lamp-front.jpg",
        "https://shop.example.com/images/aurora-lamp-side.jpg",
      ]);
  });

  it("collapses duplicate photo URLs that differ only by image size or format transforms", () => {
    const { document } = parseHTML(`
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        name: "Aurora Glass Lamp",
        image: [
          "/images/aurora-front.jpg?width=1200&quality=90",
          "/images/aurora-front.jpg?width=640&format=webp",
          "/images/aurora-side.jpg?width=1200",
        ],
      })}</script>
      <main><h1>Aurora Glass Lamp</h1></main>
    `);

    expect(findProductPageImages(document, baseUrl, { productName: "Aurora Glass Lamp" }).map(({ url }) => url))
      .toEqual([
        "https://shop.example.com/images/aurora-front.jpg?width=1200&quality=90",
        "https://shop.example.com/images/aurora-side.jpg?width=1200",
      ]);
  });

  it("collapses H&M image transforms by their stable source photo path", () => {
    const { document } = parseHTML(`
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        name: "Relaxed Fit Printed T-shirt",
        image: [
          "https://lp2.hm.com/hmgoepprod?set=source[/model/0967955204/front.jpg]&call=url[file:/product/main]",
          "https://lp2.hm.com/hmgoepprod?set=source[/model/0967955204/front.jpg]&call=url[file:/product/zoom]",
          "https://lp2.hm.com/hmgoepprod?set=source[/model/0967955204/back.jpg]&call=url[file:/product/main]",
        ],
      })}</script>
      <main><h1>Relaxed Fit Printed T-shirt</h1></main>
    `);

    expect(findProductPageImages(document, "https://www2.hm.com/en_gb/productpage.0967955204.html", {
      productName: "Relaxed Fit Printed T-shirt",
    }).map(({ url }) => url)).toEqual([
      "https://lp2.hm.com/hmgoepprod?set=source[/model/0967955204/front.jpg]&call=url[file:/product/main]",
      "https://lp2.hm.com/hmgoepprod?set=source[/model/0967955204/back.jpg]&call=url[file:/product/main]",
    ]);
  });

  it("offers one best-quality URL for each gallery image element", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Aurora Glass Lamp</h1>
        <div class="product-gallery">
          <img
            src="/images/aurora-lamp-front.jpg?width=240"
            srcset="/images/aurora-lamp-front.jpg?width=240 240w, /images/aurora-lamp-front.jpg?width=1200 1200w"
            data-zoom-image="/images/aurora-lamp-front.jpg?width=1800"
            width="900" height="900" alt="Aurora Glass Lamp product front">
        </div>
      </main>
    `);

    expect(findProductPageImages(document, baseUrl, { productName: "Aurora Glass Lamp" }).map(({ url }) => url))
      .toEqual(["https://shop.example.com/images/aurora-lamp-front.jpg?width=1200"]);
  });

  it("finds the full current-product gallery before below-fold images are rendered", () => {
    const productId = "0967955204";
    const embeddedImages = Array.from({ length: 12 }, (_, index) =>
      `https://image.shop.example.com/${productId}/view-${index + 1}.jpg?width=1200`,
    );
    const { document } = parseHTML(`
      <head>
        <meta property="og:image" content="https://image.shop.example.com/9999999999/recommended.jpg">
        <script type="application/json">${JSON.stringify({
          page: {
            product: {
              productId,
              name: "Relaxed Fit Printed T-shirt",
              mediaGallery: embeddedImages.map((src) => ({ src })),
              recommendations: [{ image: "https://image.shop.example.com/9999999999/other.jpg" }],
            },
          },
        })}</script>
      </head>
      <body><main>
        <section class="product-media">
          <img data-image-url="${embeddedImages[0]}" alt="Relaxed Fit Printed T-shirt front">
          <img data-src-large="${embeddedImages[1]}" alt="Relaxed Fit Printed T-shirt side">
        </section>
        <section class="recommendations">
          <img src="https://image.shop.example.com/9999999999/other.jpg" alt="Another shirt">
        </section>
      </main></body>
    `);

    const images = findProductPageImages(
      document,
      `https://shop.example.com/productpage.${productId}.html`,
      { productName: "Relaxed Fit Printed T-shirt", productIdentifiers: [productId] },
    ).map(({ url }) => url);

    expect(images).toHaveLength(12);
    expect(images).toEqual(expect.arrayContaining(embeddedImages));
    expect(images.some((image) => image.includes("9999999999"))).toBe(false);
  });

  it("prefers a product-only catalogue shot over the first lifestyle image", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Oversized Flannel Shirt</h1>
        <div class="product-gallery">
          <img src="/images/flannel-lifestyle.jpg" width="900" height="1200" alt="Oversized Flannel Shirt model image">
          <img src="/images/flannel-product-front.jpg" width="900" height="1200" alt="Oversized Flannel Shirt product front">
        </div>
      </main>
    `);

    expect(findProductPageImage(document, baseUrl, { productName: "Oversized Flannel Shirt" })?.url)
      .toBe("https://shop.example.com/images/flannel-product-front.jpg");
  });

  it("prefers the gallery image marked as selected", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Aurora Glass Lamp</h1>
        <div class="product-gallery">
          <img src="/images/alternate.jpg" width="700" height="700" alt="Aurora Glass Lamp">
          <button aria-selected="true"><img src="/images/chosen.jpg" width="700" height="700" alt="Aurora Glass Lamp"></button>
        </div>
      </main>
    `);

    expect(findProductPageImage(document, baseUrl, { productName: "Aurora Glass Lamp" })?.url)
      .toBe("https://shop.example.com/images/chosen.jpg");
  });

  it("uses the largest srcset image instead of its thumbnail", () => {
    const { document } = parseHTML(`
      <main>
        <h1>Aurora Glass Lamp</h1>
        <div data-product-gallery>
          <img
            src="/images/aurora-lamp-thumb.jpg"
            srcset="/images/aurora-lamp-thumb.jpg 160w, /images/aurora-lamp-medium.jpg 640w, /images/aurora-lamp-hi-res.jpg 1400w"
            width="700" height="700" alt="Aurora Glass Lamp">
        </div>
      </main>
    `);

    expect(findProductPageImage(document, baseUrl, { productName: "Aurora Glass Lamp" })?.url)
      .toBe("https://shop.example.com/images/aurora-lamp-hi-res.jpg");
  });

  it("rejects banners, logos, and recommendation images", () => {
    const { document } = parseHTML(`
      <head>
        <meta property="og:image" content="/assets/promo-banner.jpg">
        <meta property="og:image:width" content="1600">
        <meta property="og:image:height" content="240">
      </head>
      <main>
        <div class="product-gallery"><img src="/assets/logo.svg" width="400" height="200"></div>
        <aside class="related-products">
          <div class="product-gallery"><img src="/images/recommended-chair.jpg" width="800" height="800"></div>
        </aside>
      </main>
    `);

    expect(findProductPageImage(document, baseUrl, { productName: "Aurora Glass Lamp" })).toBeNull();
  });

  it("returns no image when every candidate is invalid or too small", () => {
    expect(selectProductImage([
      { value: "data:image/png;base64,abc", source: "json_ld" },
      { value: "/icons/cart.png", source: "gallery", width: 24, height: 24 },
      { value: "not a url", source: "open_graph" },
    ], undefined, "Aurora Glass Lamp")).toBeNull();
  });

  it("keeps a legitimate lifestyle or model shot", () => {
    expect(selectProductImage([{
      value: "/images/aurora-lamp-lifestyle-model.jpg",
      source: "gallery",
      width: 900,
      height: 1200,
      alt: "Model reading beside the Aurora Glass Lamp",
    }], baseUrl, "Aurora Glass Lamp")).toEqual({
      url: "https://shop.example.com/images/aurora-lamp-lifestyle-model.jpg",
      source: "gallery",
    });
  });

  it("lets a retailer adapter override generic metadata", () => {
    const { document } = parseHTML(`
      <head><meta property="og:image" content="/images/social.jpg"></head>
      <main>
        <div data-retailer-product-image>
          <img src="/images/retailer-primary.jpg" width="600" height="600" alt="Aurora Glass Lamp">
        </div>
      </main>
    `);

    expect(findProductPageImage(document, baseUrl, {
      productName: "Aurora Glass Lamp",
      structuredImage: "/images/schema-primary.jpg",
      retailerSelectors: ["[data-retailer-product-image] img"],
    })?.url).toBe("https://shop.example.com/images/retailer-primary.jpg");
  });

  it("still extracts and saves a product when image extraction fails", () => {
    const { document } = parseHTML(`
      <script type="application/ld+json">
        {"@type":"Product","name":"Aurora Glass Lamp","image":"data:image/png;base64,bad"}
      </script>
    `);

    expect(extractSavedProduct(document, baseUrl)).toEqual({
      name: "Aurora Glass Lamp",
      retailer: "Shop",
      retailerId: "store_shop-example-com",
      canonicalUrl: baseUrl,
    });
  });
});
