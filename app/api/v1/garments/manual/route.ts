import { getDb } from "@/db";
import { garments } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { garmentCutoutKey, getMediaBucket } from "@/lib/storage";

const maximumImageBytes = 15 * 1024 * 1024;
const validCategories = new Set(["tops", "layers", "bottoms", "footwear", "accessories"]);

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  if (request.headers.get("content-type")?.toLowerCase() !== "image/png") {
    return failure("png_required", 400);
  }

  const url = new URL(request.url);
  const name = clean(url.searchParams.get("name"), 100);
  const category = clean(url.searchParams.get("category"), 20);
  const type = clean(url.searchParams.get("type"), 80);
  const color = clean(url.searchParams.get("color"), 60);
  const description = clean(url.searchParams.get("description"), 240);
  if (!name || !category || !validCategories.has(category) || !type || !color) {
    return failure("garment_metadata_invalid", 400);
  }

  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maximumImageBytes) {
    return failure("garment_image_too_large", 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!isPng(bytes) || bytes.byteLength > maximumImageBytes) {
    return failure("garment_image_invalid", 400);
  }

  const garmentId = `garment_${crypto.randomUUID()}`;
  const key = garmentCutoutKey(identity.ownerId, garmentId);
  const now = new Date().toISOString();
  await getMediaBucket().put(key, bytes, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { ownerId: identity.ownerId, garmentId, purpose: "private-manual-garment-cutout" },
  });

  try {
    await getDb().insert(garments).values({
      id: garmentId,
      ownerId: identity.ownerId,
      batchId: null,
      name,
      category: category as "tops" | "layers" | "bottoms" | "footwear" | "accessories",
      type,
      color,
      material: "Básico de referencia",
      description: description || `${name}, añadido manualmente a tu armario privado.`,
      sourceType: "internet",
      sourceUrl: null,
      confidence: 100,
      isBasic: true,
      fingerprint: `manual|${garmentId}`,
      cutoutKey: key,
      reconstructionModel: "manual-reference",
      reconstructionQuality: "final",
      reconstructionApprovedAt: now,
      reconstructedAt: now,
      qaStatus: "pass",
      qaJson: JSON.stringify({ visual: { summary: "Básico añadido manualmente para combinaciones y prueba virtual.", issues: [] } }),
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    await getMediaBucket().delete(key).catch(() => undefined);
    throw error;
  }

  return Response.json({
    garment: {
      id: garmentId,
      name,
      category,
      type,
      color,
      material: "Básico de referencia",
      description: description || `${name}, añadido manualmente a tu armario privado.`,
      sourceType: "internet",
      sourceUrl: null,
      confidence: 100,
      isBasic: true,
      status: "approved",
      reconstructionQuality: "final",
      qaStatus: "pass",
      imagePath: `/api/v1/media/garments/${garmentId}`,
      imageKind: "cutout",
    },
  }, { status: 201, headers: privateHeaders() });
}

function isPng(bytes: Uint8Array) {
  return bytes.byteLength >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function clean(value: string | null, maxLength: number) {
  const cleaned = value?.replace(/\s+/gu, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
