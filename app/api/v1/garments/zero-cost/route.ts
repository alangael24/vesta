import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { garments } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import {
  createZeroCostGarmentAsset,
  isLikelyDuplicateFingerprint,
  zeroVisionFingerprint,
} from "@/lib/zero-vision/garment";
import type { NormalizedRect, SegmentationMode } from "@/lib/zero-vision/core";
import { ZeroVisionError } from "@/lib/zero-vision/core";
import { garmentCutoutKey, getMediaBucket } from "@/lib/storage";
import {
  recordConsumedUsage,
  requireUsageCapacity,
  SubscriptionUsageError,
} from "@/lib/subscription-usage-server";

const maximumImageBytes = 12 * 1024 * 1024;
const categories = new Set(["tops", "layers", "bottoms", "footwear", "accessories", "one_piece"]);

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure("zero_vision_form_invalid", 400);
  }

  const image = form.get("image");
  const category = cleanCategory(form.get("category"));
  const mode = cleanMode(form.get("mode"));
  if (!(image instanceof File) || !category || !mode) return failure("zero_vision_input_required", 400);
  if (!isSupportedImage(image)) return failure("zero_vision_image_invalid", 400);
  const rect = mode === "rectangle" ? parseRect(form.get("rect")) : undefined;
  if (mode === "rectangle" && !rect) return failure("zero_vision_rectangle_required", 400);

  let entitlement;
  try {
    entitlement = await requireUsageCapacity(identity.ownerId, "wardrobe_addition", 1);
  } catch (error) {
    if (error instanceof SubscriptionUsageError) return failure(error.code, error.status, error.limit);
    throw error;
  }

  let asset;
  try {
    asset = createZeroCostGarmentAsset(
      new Uint8Array(await image.arrayBuffer()),
      image.type,
      { mode, rect: rect ?? undefined },
    );
  } catch (error) {
    const code = error instanceof ZeroVisionError ? error.code : "zero_vision_segmentation_failed";
    return failure(code, 422);
  }

  if (!asset.accepted) {
    return Response.json({
      error: "zero_vision_quality_low",
      metrics: asset.metrics,
      guidance: guidanceFor(asset.metrics.reasons),
      paidFallbackAvailable: true,
    }, { status: 422, headers: privateHeaders() });
  }

  const db = getDb();
  const existing = await db.select({ id: garments.id, fingerprint: garments.fingerprint })
    .from(garments).where(and(eq(garments.ownerId, identity.ownerId), eq(garments.category, category), isNotNull(garments.fingerprint)));
  const duplicate = isLikelyDuplicateFingerprint({ category, hash: asset.hash }, existing);
  if (duplicate) {
    return Response.json({
      ok: true,
      duplicate: true,
      garmentId: duplicate.id,
      distance: duplicate.distance,
      modelCostUsd: 0,
    }, { headers: privateHeaders() });
  }

  const garmentId = `garment_${crypto.randomUUID()}`;
  const cutoutKey = garmentCutoutKey(identity.ownerId, garmentId);
  const now = new Date().toISOString();
  const name = cleanLabel(form.get("name"), 100) || `${defaultType(category)} ${asset.color.name.toLowerCase()}`;
  const type = cleanLabel(form.get("type"), 80) || defaultType(category);
  const suppliedColor = cleanLabel(form.get("color"), 80);
  const color = suppliedColor || asset.color.name;
  const qaStatus = asset.reviewRecommended ? "review" : "pass";
  const status = asset.reviewRecommended ? "qa" : "approved";
  const fingerprint = zeroVisionFingerprint(category, asset.hash);
  const bucket = getMediaBucket();

  await bucket.put(cutoutKey, asset.png, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: {
      ownerId: identity.ownerId,
      garmentId,
      purpose: "zero-cost-deterministic-cutout",
      algorithm: `zero-vision-${mode}-v1`,
      modelCostUsd: "0",
    },
  });

  try {
    await db.insert(garments).values({
      id: garmentId,
      ownerId: identity.ownerId,
      batchId: null,
      name,
      category,
      type,
      color,
      secondaryColor: null,
      tagsJson: JSON.stringify(["zero-cost", mode === "plain" ? "captura-guiada" : "segmentación-asistida"]),
      material: null,
      description: "Prenda recortada con visión clásica determinista, sin generación ni QA de modelo.",
      sourceType: "photos",
      sourceUrl: null,
      confidence: Math.round(asset.metrics.score),
      isBasic: false,
      fingerprint,
      cutoutKey,
      reconstructionModel: `zero-vision-${mode}-v1`,
      reconstructionQuality: "final",
      reconstructionApprovedAt: qaStatus === "pass" ? now : null,
      reconstructedAt: now,
      cutoutWidth: asset.width,
      cutoutHeight: asset.height,
      transparentPixelRatio: Math.round(asset.metrics.transparentPixelRatio),
      qaStatus,
      qaJson: JSON.stringify({
        technical: asset.metrics,
        visual: {
          verdict: qaStatus === "pass" ? "pass" : "review",
          summary: qaStatus === "pass"
            ? "Recorte determinista aprobado por controles geométricos y de conectividad."
            : "El recorte es utilizable, pero conviene revisarlo visualmente.",
          issues: asset.metrics.reasons,
          model: null,
          modelCostUsd: 0,
        },
      }),
      status,
      createdAt: now,
      updatedAt: now,
    });
    await recordConsumedUsage(identity.ownerId, "wardrobe_addition", 1, `zero-vision:${garmentId}`, entitlement);
  } catch (error) {
    await Promise.all([
      bucket.delete(cutoutKey).catch(() => undefined),
      db.delete(garments).where(and(eq(garments.id, garmentId), eq(garments.ownerId, identity.ownerId))).catch(() => undefined),
    ]);
    throw error;
  }

  return Response.json({
    ok: true,
    duplicate: false,
    modelCostUsd: 0,
    garment: {
      id: garmentId,
      name,
      category,
      type,
      color,
      secondaryColor: null,
      tags: ["zero-cost", mode === "plain" ? "captura-guiada" : "segmentación-asistida"],
      material: "Sin confirmar",
      description: "Prenda recortada sin IA de pago.",
      sourceType: "photos",
      confidence: Math.round(asset.metrics.score),
      isBasic: false,
      status,
      reconstructionQuality: "final",
      transparentPixelRatio: Math.round(asset.metrics.transparentPixelRatio),
      qaStatus,
      qaSummary: { summary: "Segmentación determinista · coste de modelo $0", issues: asset.metrics.reasons },
      imagePath: `/api/v1/media/garments/${garmentId}?v=${encodeURIComponent(now)}`,
      evidencePath: null,
      imageKind: "cutout",
    },
    metrics: asset.metrics,
  }, { status: 201, headers: privateHeaders() });
}

function cleanMode(value: FormDataEntryValue | null): SegmentationMode | null {
  return value === "plain" || value === "rectangle" ? value : null;
}

function cleanCategory(value: FormDataEntryValue | null) {
  return typeof value === "string" && categories.has(value) ? value : null;
}

function cleanLabel(value: FormDataEntryValue | null, maximum: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function parseRect(value: FormDataEntryValue | null): NormalizedRect | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Partial<NormalizedRect>;
    const numbers = [parsed.x, parsed.y, parsed.width, parsed.height];
    if (!numbers.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;
    if ((parsed.width || 0) < 0.03 || (parsed.height || 0) < 0.03) return null;
    return {
      x: clamp(parsed.x!, 0, 0.97),
      y: clamp(parsed.y!, 0, 0.97),
      width: clamp(parsed.width!, 0.03, 1),
      height: clamp(parsed.height!, 0.03, 1),
    };
  } catch {
    return null;
  }
}

function isSupportedImage(file: File) {
  return file.size > 0 && file.size <= maximumImageBytes && ["image/jpeg", "image/png"].includes(file.type.toLowerCase());
}

function defaultType(category: string) {
  if (category === "tops") return "Top";
  if (category === "layers") return "Capa";
  if (category === "bottoms") return "Pantalón o falda";
  if (category === "footwear") return "Calzado";
  if (category === "one_piece") return "Vestido o enterizo";
  return "Accesorio";
}

function guidanceFor(reasons: string[]) {
  if (reasons.includes("background_not_uniform")) return "Usa un fondo liso que contraste con la prenda, o cambia al modo Foto normal y encierra la prenda.";
  if (reasons.includes("foreground_touches_edges")) return "Deja espacio alrededor de toda la prenda y evita recortarla con el borde de la foto.";
  if (reasons.includes("foreground_background_similar")) return "El fondo y la prenda tienen colores muy parecidos. Usa un fondo contrastante o ajusta el rectángulo.";
  return "Coloca una sola prenda completa, sin manos ni objetos encima, con luz uniforme.";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function failure(error: string, status: number, limit?: number) {
  return Response.json({ error, limit }, { status, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
