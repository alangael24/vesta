import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { hashSecret } from "@/lib/crypto";
import { getImagesBinding } from "@/lib/openai";
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
    let imageResponse: Response;

    if (pageType.startsWith("image/")) {
      title = decodeURIComponent(page.finalUrl.pathname.split("/").filter(Boolean).at(-1) || "Prenda de internet").replace(/[-_]+/gu, " ");
      imageUrl = page.finalUrl;
      imageResponse = page.response;
    } else {
      if (!pageType.includes("text/html") && !pageType.includes("application/xhtml+xml")) throw new ProductImportError("product_page_invalid");
      const html = new TextDecoder().decode(await readLimited(page.response, maximumPageBytes, "product_page_too_large"));
      const metadata = parseProductPage(html, page.finalUrl);
      if (!metadata.imageUrl) throw new ProductImportError("product_image_missing");
      if (!isSafeRemoteUrl(metadata.imageUrl)) throw new ProductImportError("product_image_unsafe");
      title = metadata.title;
      imageUrl = metadata.imageUrl;
      imageResponse = (await fetchRemote(imageUrl, "image/avif,image/webp,image/png,image/jpeg,image/*", page.finalUrl)).response;
    }

    const imageType = imageResponse.headers.get("content-type")?.toLowerCase() || "";
    if (!imageType.startsWith("image/")) throw new ProductImportError("product_image_invalid");
    const imageBytes = await readLimited(imageResponse, maximumImageBytes, "product_image_too_large");
    const inputStream = new Response(imageBytes, { headers: { "Content-Type": imageType } }).body;
    if (!inputStream) throw new ProductImportError("product_image_invalid");
    const transformed = await getImagesBinding().input(inputStream)
      .transform({ width: 1600, height: 1600, fit: "scale-down" })
      .output({ format: "image/png", quality: 100 });
    const normalized = transformed.response();
    const normalizedBytes = await normalized.arrayBuffer();
    if (!normalized.ok || !normalizedBytes.byteLength) throw new ProductImportError("product_image_invalid");

    const classification = classifyInternetGarment(title, productUrl, placement);
    const garmentId = `garment_${crypto.randomUUID()}`;
    const key = internetGarmentKey(identity.ownerId, garmentId);
    const now = new Date().toISOString();
    await getMediaBucket().put(key, normalizedBytes, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        ownerId: identity.ownerId,
        garmentId,
        sourceHost: productUrl.hostname,
        sourceImageHost: imageUrl.hostname,
        purpose: "private-internet-garment-reference",
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
        reconstructionModel: "retailer-product-reference",
        reconstructionQuality: "final",
        reconstructionApprovedAt: now,
        reconstructedAt: now,
        transparentPixelRatio: 0,
        qaStatus: "pass",
        qaJson: JSON.stringify({ visual: { summary: "Referencia de producto importada desde su página pública.", issues: [] } }),
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
        transparentPixelRatio: 0,
        qaStatus: "pass",
        qaJson: JSON.stringify({ visual: { summary: "Referencia de producto importada desde su página pública.", issues: [] } }),
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
