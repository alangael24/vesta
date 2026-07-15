export type ProductPlacement = "auto" | "head" | "top" | "outer" | "legs" | "feet";

export type InternetGarmentClassification = {
  category: "tops" | "layers" | "bottoms" | "footwear" | "accessories";
  type: string;
  color: string;
};

const trackingParameters = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_", "source",
]);

export function canonicalizeProductUrl(input: string) {
  const trimmed = input.trim();
  const url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
  url.hash = "";
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.toLowerCase().startsWith("utm_") || trackingParameters.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url;
}

export function imageFetchUrl(input: URL) {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  if (host === "cdn.shopify.com" || host.endsWith(".shopifycdn.com")) {
    const requestedWidth = Number(url.searchParams.get("width"));
    if (!Number.isFinite(requestedWidth) || requestedWidth > 1_600 || requestedWidth < 1) {
      url.searchParams.set("width", "1600");
    }
  }
  return url;
}

export function isSafeRemoteUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (!host || host.includes(":") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".onion")) {
    return false;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u)?.slice(1).map(Number);
  if (!ipv4) return true;
  if (ipv4.some((part) => part < 0 || part > 255)) return false;
  const [a, b, c] = ipv4;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
  );
}

export function parseProductPage(html: string, pageUrl: URL) {
  const metadata = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/giu) || []) {
    const attrs = htmlAttributes(tag);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    const content = attrs.content;
    if (key && content && !metadata.has(key)) metadata.set(key, decodeHtml(content));
  }

  const structured = structuredProduct(html);
  const documentTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  const title = cleanProductTitle(
    metadata.get("og:title")
      || metadata.get("twitter:title")
      || structured?.name
      || (documentTitle ? decodeHtml(documentTitle.replace(/<[^>]+>/gu, " ")) : "")
      || productNameFromPath(pageUrl),
  );
  const rawImages = [
    metadata.get("og:image:secure_url"),
    metadata.get("og:image"),
    metadata.get("twitter:image"),
    metadata.get("twitter:image:src"),
    structured?.image,
    ...htmlImageCandidates(html, title),
  ].filter((value): value is string => Boolean(value));
  const imageUrls: URL[] = [];
  const seen = new Set<string>();
  for (const rawImage of rawImages) {
    try {
      const imageUrl = new URL(decodeHtml(rawImage), pageUrl);
      if (!seen.has(imageUrl.toString())) {
        seen.add(imageUrl.toString());
        imageUrls.push(imageUrl);
      }
    } catch {
      // A malformed fallback image should not hide the next valid candidate.
    }
  }
  return { title, imageUrl: imageUrls[0] || null, imageUrls };
}

export function classifyInternetGarment(title: string, productUrl: URL, placement: ProductPlacement = "auto"): InternetGarmentClassification {
  if (placement !== "auto") return classificationForPlacement(placement, title);
  const descriptor = `${title} ${decodeURIComponent(productUrl.pathname)}`.toLowerCase();
  const color = colorFromDescriptor(descriptor);
  if (/(gorra|cachucha|sombrero|beanie|bucket hat|baseball cap|snapback|trucker hat|\bcap\b|\bhat\b)/u.test(descriptor)) {
    return { category: "accessories", type: /beanie|gorro/u.test(descriptor) ? "gorro" : "gorra", color };
  }
  if (/(sneaker|trainer|shoe|boot|loafer|sandal|zapato|tenis|bota|calzado|zapatilla)/u.test(descriptor)) {
    return { category: "footwear", type: "calzado", color };
  }
  if (/(jean|pants|trouser|chino|shorts|jogger|sweatpant|pantal[oó]n|vaquero|bermuda)/u.test(descriptor)) {
    return { category: "bottoms", type: "pantalón", color };
  }
  if (/(jacket|coat|hoodie|sweater|cardigan|overshirt|blazer|chaqueta|abrigo|sudadera|su[eé]ter|cazadora)/u.test(descriptor)) {
    return { category: "layers", type: "capa exterior", color };
  }
  if (/(dress|jumpsuit|overall|vestido|mono|enterizo)/u.test(descriptor)) {
    return { category: "layers", type: "prenda de una pieza", color };
  }
  if (/(t-?shirt|tee|shirt|polo|tank|jersey|blouse|camisa|camiseta|playera|polo|top)/u.test(descriptor)) {
    return { category: "tops", type: "prenda superior", color };
  }
  return { category: "tops", type: "prenda superior", color };
}

function classificationForPlacement(placement: Exclude<ProductPlacement, "auto">, title: string): InternetGarmentClassification {
  const color = colorFromDescriptor(title.toLowerCase());
  if (placement === "head") return { category: "accessories", type: "gorra o accesorio de cabeza", color };
  if (placement === "outer") return { category: "layers", type: "capa exterior", color };
  if (placement === "legs") return { category: "bottoms", type: "prenda inferior", color };
  if (placement === "feet") return { category: "footwear", type: "calzado", color };
  return { category: "tops", type: "prenda superior", color };
}

function colorFromDescriptor(value: string) {
  const colors: Array<[RegExp, string]> = [
    [/\b(black|negro|negra)\b/u, "negro"],
    [/\b(white|blanco|blanca|cream|ivory)\b/u, "blanco"],
    [/\b(red|rojo|roja|burgundy|maroon)\b/u, "rojo"],
    [/\b(blue|azul|navy)\b/u, "azul"],
    [/\b(green|verde|olive)\b/u, "verde"],
    [/\b(gray|grey|gris|charcoal)\b/u, "gris"],
    [/\b(brown|cafe|café|tan|camel)\b/u, "café"],
    [/\b(pink|rosa)\b/u, "rosa"],
    [/\b(purple|violet|morado|morada)\b/u, "morado"],
    [/\b(yellow|amarillo|amarilla)\b/u, "amarillo"],
    [/\b(orange|naranja)\b/u, "naranja"],
  ];
  return colors.find(([pattern]) => pattern.test(value))?.[1] || "Según la referencia";
}

function htmlAttributes(tag: string) {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of tag.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    if (key !== "meta") attrs[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function htmlImageCandidates(html: string, title: string) {
  const candidates: Array<{ value: string; score: number }> = [];
  for (const tag of html.match(/<link\b[^>]*>/giu) || []) {
    const attrs = htmlAttributes(tag);
    if (/^(?:image_src|preload)$/iu.test(attrs.rel || "") && attrs.href) {
      candidates.push({ value: attrs.href, score: attrs.rel.toLowerCase() === "image_src" ? 90 : 20 });
    }
  }
  const titleWords = title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4);
  for (const tag of html.match(/<img\b[^>]*>/giu) || []) {
    const attrs = htmlAttributes(tag);
    const value = attrs["data-zoom-image"] || attrs["data-large-image"] || attrs["data-src"] || largestSrcset(attrs.srcset || attrs["data-srcset"]) || attrs.src;
    if (!value || /^data:/iu.test(value)) continue;
    const description = `${attrs.id || ""} ${attrs.class || ""} ${attrs.alt || ""} ${value}`.toLowerCase();
    if (/logo|icon|sprite|avatar|badge|payment|placeholder|spinner/u.test(description)) continue;
    let score = 0;
    if (/product|pdp|gallery|main|primary|hero|zoom/u.test(description)) score += 50;
    if (titleWords.some((word) => description.includes(word))) score += 20;
    const width = Number(attrs.width);
    const height = Number(attrs.height);
    if (width >= 500 || height >= 500) score += 15;
    if (/thumb|swatch|recommend|related|carousel/u.test(description)) score -= 20;
    candidates.push({ value, score });
  }
  return candidates.sort((a, b) => b.score - a.score).map((candidate) => decodeHtml(candidate.value));
}

function largestSrcset(value: string | undefined) {
  if (!value) return "";
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.at(-1)?.split(/\s+/u)[0] || "";
}

function structuredProduct(html: string): { name?: string; image?: string } | null {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    try {
      const product = findProduct(JSON.parse(decodeHtml(match[1])), 0);
      if (product) return product;
    } catch {
      // Invalid retailer markup should not prevent Open Graph extraction.
    }
  }
  return null;
}

function findProduct(value: unknown, depth: number): { name?: string; image?: string } | null {
  if (depth > 8 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findProduct(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawType = record["@type"];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  if (types.some((type) => typeof type === "string" && type.toLowerCase() === "product")) {
    return {
      name: typeof record.name === "string" ? decodeHtml(record.name) : undefined,
      image: imageValue(record.image),
    };
  }
  for (const entry of Object.values(record)) {
    const found = findProduct(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

function imageValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(imageValue).find(Boolean);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record.url, record.contentUrl].find((entry): entry is string => typeof entry === "string");
  }
  return undefined;
}

function cleanProductTitle(value: string) {
  return decodeHtml(value).replace(/\s+/gu, " ").trim().slice(0, 100) || "Prenda de internet";
}

function productNameFromPath(url: URL) {
  const segment = url.pathname.split("/").filter(Boolean).at(-1) || url.hostname;
  return decodeURIComponent(segment).replace(/[-_]+/gu, " ");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#(\d+);/gu, (_, number: string) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/giu, (_, number: string) => String.fromCodePoint(Number.parseInt(number, 16)));
}
