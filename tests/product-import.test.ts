import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeProductUrl,
  classifyInternetGarment,
  isSafeRemoteUrl,
  parseProductPage,
} from "../lib/product-import.ts";

test("extracts a retailer product title and image regardless of meta attribute order", () => {
  const page = new URL("https://shop.example.com/products/black-cap");
  const parsed = parseProductPage(`
    <html><head>
      <meta content="Black &amp; Gold Baseball Cap" property="og:title">
      <meta content="/images/cap.png?width=1200&amp;format=png" property="og:image">
    </head></html>
  `, page);
  assert.equal(parsed.title, "Black & Gold Baseball Cap");
  assert.equal(parsed.imageUrl?.toString(), "https://shop.example.com/images/cap.png?width=1200&format=png");
});

test("falls back to Product JSON-LD and classifies common garments", () => {
  const page = new URL("https://shop.example.com/products/navy-hoodie");
  const parsed = parseProductPage(`
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Navy Zip Hoodie","image":["https://cdn.example.com/hoodie.webp"]}
    </script>
  `, page);
  assert.equal(parsed.imageUrl?.hostname, "cdn.example.com");
  assert.deepEqual(classifyInternetGarment(parsed.title, page), {
    category: "layers",
    type: "capa exterior",
    color: "azul",
  });
});

test("falls back to a likely product img when a store omits social metadata", () => {
  const page = new URL("https://shop.example.com/products/essential-cap");
  const parsed = parseProductPage(`
    <title>Essential Cap</title>
    <img class="site-logo" src="/logo.png" width="200">
    <img class="pdp-main-product-image" alt="Essential Cap black" data-src="/media/cap-black.jpg" width="1200">
    <img class="related-product-thumb" src="/media/other.jpg" width="600">
  `, page);
  assert.equal(parsed.imageUrl?.toString(), "https://shop.example.com/media/cap-black.jpg");
  assert.equal(parsed.imageUrls.length, 2);
});

test("a placement hint overrides an ambiguous product name", () => {
  const result = classifyInternetGarment("Essential 59FIFTY", new URL("https://shop.example.com/item/123"), "head");
  assert.equal(result.category, "accessories");
  assert.equal(result.type, "gorra o accesorio de cabeza");
});

test("canonical URLs discard tracking while remote URL checks reject private networks", () => {
  assert.equal(
    canonicalizeProductUrl("shop.example.com/cap?utm_source=x&size=m&fbclid=abc").toString(),
    "https://shop.example.com/cap?size=m",
  );
  assert.equal(isSafeRemoteUrl(new URL("https://cdn.example.com/cap.png")), true);
  assert.equal(isSafeRemoteUrl(new URL("http://127.0.0.1/cap.png")), false);
  assert.equal(isSafeRemoteUrl(new URL("http://192.168.1.20/cap.png")), false);
  assert.equal(isSafeRemoteUrl(new URL("http://localhost/cap.png")), false);
});
