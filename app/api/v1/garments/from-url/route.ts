import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { hashSecret } from "@/lib/crypto";
import { removeLightBackground } from "@/lib/light-background";
import {
  canonicalizeProductUrl,
  classifyInternetGarment,
  isSafeRemoteUrl,
  parseProductPage,
  ProductPlacement,
} from "@/lib/product-import";
import { getMediaBucket, internetGarmentKey } from "@/lib/storage";

const maximumPageBytes = 2 * 1024 * 1024;
const maximumImageBytes = 15 * 1024 * 1024;
const placements = new Set<ProductPlacement>(["auto", "head", "top", "outer", "legs", "feet"]);

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const body = await safeJson(request);
  if (!body?.url || body.url.length > 2_048) return failure("invalid_url", 400);
  const placement = placements.has(body.placement as ProductPlacement) ? body.placement as ProductPlacement : "auto";

  let productUrl: URL;
  try {
    productUrl = canonicalizeProductUrl(body.url);
  } catch {
    return failure("invalid_url", 400);
  }
  if (!isSafeRemoteUrl(productUrl)) return failure("unsafe_url", 400);

  const db = getDb();
  const [existing] = await db.select().from(garments).where(and(
    eq(garments.ownerId, identity.ownerId),
    eq(garments.sourceUrl, productUrl.toString()),
  )).limit(1);
  if (existing?.cutoutKey) {
    if (placement !== "auto") {
      const classification = classifyInternetGarment(existing.name, productUrl, placement);
      await db.update(garments).set({
        category: classification.category,
        type: classification.type,
        updatedAt: new Date().toISOString(),
      }).where(eq(garments.id, existing.id));
      return Response.json({ garment: garmentResponse({ ...existing, ...classification }) }, { headers: privateHeaders() });
    }
    return Response.json({ garment: garmentResponse(existing), existing: true }, { headers: privateHeaders() });
  }

  try {
    const page = await fetchRemote(productUrl, "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.2");
    const pageType = page.response.headers.get("content-type")?.toLowerCase() || "";
    let title: string;
    let imageUrl: URL;
    let imageBytes: Uint8Array;
    let imageType: string;

    if (pageType.startsWith("image/")) {
      title = decodeURIComponent(page.finalUrl.pathname.split("/").filter(Boolean).at(-1) || "Prenda de internet").replace(/[-_]+/gu, " ");
      imageUrl = page.finalUrl;
      imageBytes = await readLimited(page.response, maximumImageBytes, "product_image_too_large");
      imageType = supportedImageType(imageBytes) || "";
      if (!imageType) throw new ProductImportError("product_image_invalid");
    } else {
      if (!pageType.includes("text/html") && !pageType.includes("application/xhtml+xml")) throw new ProductImportError("product_page_invalid");
      const html = new TextDecoder().decode(await readLimited(page.response, maximumPageBytes, "product_page_too_large"));
      const metadata = parseProductPage(html, page.finalUrl);
      if (!metadata.imageUrls.length) throw new ProductImportError("product_image_missing");
      title = metadata.title;
      const fetchedImage = await fetchFirstUsableImage(metadata.imageUrls, page.finalUrl);
      imageUrl = fetchedImage.url;
      imageBytes = fetchedImage.bytes;
      imageType = fetchedImage.type;
    }

    const cleanup = safelyRemoveLightBackground(imageBytes, imageType);
    const hasTransparentAsset = Boolean(cleanup && (cleanup.applied || cleanup.hadTransparency));
    if (hasTransparentAsset && cleanup) {
      imageBytes = cleanup.png;
      imageType = "image/png";
    }
    const transparentPixelRatio = hasTransparentAsset ? cleanup?.stats.transparentPixelRatio || 0 : 0;
    const reconstructionModel = cleanup?.applied
      ? "retailer-product-reference+edge-cleanup"
      : "retailer-product-reference";
    const cleanupSummary = cleanup?.applied
      ? "Referencia web importada y fondo claro eliminado localmente, sin IA."
      : "Referencia de producto importada desde su página pública.";
    const classification = classifyInternetGarment(title, productUrl, placement);
    const garmentId = `garment_${crypto.randomUUID()}`;
    const key = internetGarmentKey(identity.ownerId, garmentId);
    const now = new Date().toISOString();
    await getMediaBucket().put(key, imageBytes, {
      httpMetadata: { contentType: imageType },
      customMetadata: {
        ownerId: identity.ownerId,
        garmentId,
        sourceHost: productUrl.hostname,
        sourceImageHost: imageUrl.hostname,
        purpose: cleanup?.applied ? "private-internet-garment-transparent-cutout" : "private-internet-garment-reference",
        backgroundRemoval: cleanup?.applied ? "edge-connected-light-v1" : "not-applied",
      },
    });
    try {
      await db.insert(garments).values({
        id: garmentId,
        ownerId: identity.ownerId,
        batchId: null,
        name: title.slice(0, 100),
        category: classification.category,
        type: classification.type,
        color: classification.color,
        material: "Referencia web",
        description: `Referencia pública importada desde ${productUrl.hostname}. Vesta usa únicamente la imagen del producto para tu prueba virtual.`,
        sourceType: "internet",
        sourceUrl: productUrl.toString(),
        confidence: 100,
        isBasic: false,
        fingerprint: `internet|${await hashSecret(productUrl.toString())}`,
        cutoutKey: key,
        reconstructionModel,
        reconstructionQuality: "final",
        reconstructionApprovedAt: now,
        reconstructedAt: now,
        transparentPixelRatio,
        qaStatus: "pass",
        qaJson: JSON.stringify({ visual: { summary: cleanupSummary, issues: [] }, technical: cleanup?.stats || null }),
        status: "approved",
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      await getMediaBucket().delete(key).catch(() => undefined);
      throw error;
    }

    return Response.json({
      garment: garmentResponse({
        id: garmentId,
        name: title,
        category: classification.category,
        type: classification.type,
        color: classification.color,
        material: "Referencia web",
        description: `Referencia pública importada desde ${productUrl.hostname}. Vesta usa únicamente la imagen del producto para tu prueba virtual.`,
        sourceType: "internet",
        sourceUrl: productUrl.toString(),
        confidence: 100,
        isBasic: false,
        status: "approved",
        reconstructionQuality: "final",
        transparentPixelRatio,
        qaStatus: "pass",
        qaJson: JSON.stringify({ visual: { summary: cleanupSummary, issues: [] }, technical: cleanup?.stats || null }),
        cutoutKey: key,
      }),
    }, { status: 201, headers: privateHeaders() });
  } catch (error) {
    const code = error instanceof ProductImportError ? error.code : "product_import_failed";
    const status = code.includes("too_large") ? 413 : code === "product_import_failed" ? 502 : 422;
    return failure(code, status);
  }
}

type GarmentRow = {
  id: string;
  name: string;
  category: string;
  type: string;
  color: string | null;
  material: string | null;
  description: string | null;
  sourceType: "photos" | "internet";
  sourceUrl: string | null;
  confidence: number | null;
  isBasic: boolean;
  status: string;
  reconstructionQuality: "draft" | "final" | null;
  transparentPixelRatio: number | null;
  qaStatus: "pending" | "pass" | "review" | "fail" | null;
  qaJson: string | null;
  cutoutKey: string | null;
};

function garmentResponse(row: GarmentRow) {
  let qaSummary: { summary: string | null; issues: string[] } = { summary: null, issues: [] };
  try {
    const parsed = JSON.parse(row.qaJson || "{}") as { visual?: { summary?: string; issues?: string[] } };
    qaSummary = { summary: parsed.visual?.summary || null, issues: parsed.visual?.issues || [] };
  } catch {
    // The product reference itself remains usable if optional QA copy is malformed.
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    type: row.type,
    color: row.color || "Según la referencia",
    material: row.material || "Referencia web",
    description: row.description || "Prenda importada desde internet.",
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    confidence: row.confidence,
    isBasic: row.isBasic,
    status: row.status,
    reconstructionQuality: row.reconstructionQuality,
    transparentPixelRatio: row.transparentPixelRatio,
    qaStatus: row.qaStatus,
    qaSummary,
    imagePath: row.cutoutKey ? `/api/v1/media/garments/${row.id}` : null,
    evidencePath: null,
    imageKind: row.cutoutKey ? "cutout" : "evidence",
  };
}

async function fetchRemote(initialUrl: URL, accept: string, referer?: URL) {
  let url = initialUrl;
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    if (!isSafeRemoteUrl(url)) throw new ProductImportError("unsafe_url");
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        headers: {
          "Accept": accept,
          "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Vesta/1.0",
          ...(referer ? { Referer: referer.toString() } : {}),
        },
      });
    } catch {
      throw new ProductImportError("product_unreachable");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 4) throw new ProductImportError("product_redirect_invalid");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new ProductImportError(response.status === 401 || response.status === 403 ? "product_page_blocked" : "product_unreachable");
    return { response, finalUrl: url };
  }
  throw new ProductImportError("product_redirect_invalid");
}

async function fetchFirstUsableImage(candidates: URL[], referer: URL) {
  let lastError: ProductImportError | null = null;
  for (const url of candidates.slice(0, 8)) {
    if (!isSafeRemoteUrl(url)) continue;
    try {
      // Prefer formats we can decode deterministically in the Worker for background removal.
      const result = await fetchRemote(url, "image/png,image/jpeg,image/webp;q=0.8,image/*;q=0.7", referer);
      const declaredType = normalizedContentType(result.response.headers.get("content-type"));
      if (declaredType.startsWith("image/") && !supportedDeclaredImageTypes.has(declaredType)) {
        await result.response.body?.cancel().catch(() => undefined);
        continue;
      }
      const bytes = await readLimited(result.response, maximumImageBytes, "product_image_too_large");
      const type = supportedImageType(bytes);
      if (!type) continue;
      return { url: result.finalUrl, bytes, type };
    } catch (error) {
      lastError = error instanceof ProductImportError ? error : new ProductImportError("product_unreachable");
    }
  }
  throw lastError || new ProductImportError("product_image_invalid");
}

const supportedDeclaredImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/octet-stream", ""]);

function normalizedContentType(value: string | null) {
  return (value || "").split(";", 1)[0].trim().toLowerCase();
}

function supportedImageType(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function safelyRemoveLightBackground(bytes: Uint8Array, contentType: string) {
  try {
    return removeLightBackground(bytes, contentType);
  } catch {
    // A retailer reference remains useful if its codec or dimensions cannot be processed locally.
    return null;
  }
}

async function readLimited(response: Response, maximumBytes: number, errorCode: string) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new ProductImportError(errorCode);
  if (!response.body) throw new ProductImportError("product_empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new ProductImportError(errorCode);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!result.byteLength) throw new ProductImportError("product_empty_response");
  return result;
}

async function safeJson(request: Request): Promise<{ url?: string; placement?: string } | null> {
  try {
    const value = await request.json() as { url?: unknown; placement?: unknown };
    return {
      url: typeof value.url === "string" ? value.url : undefined,
      placement: typeof value.placement === "string" ? value.placement : undefined,
    };
  } catch {
    return null;
  }
}

class ProductImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
