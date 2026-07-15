import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { removeLightBackground } from "@/lib/light-background";
import { getMediaBucket } from "@/lib/storage";

type RouteContext = { params: Promise<{ garmentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { garmentId } = await context.params;
  const db = getDb();
  const [garment] = await db.select({
    status: garments.status,
    sourceType: garments.sourceType,
    cutoutKey: garments.cutoutKey,
    previewKey: garments.previewKey,
    transparentPixelRatio: garments.transparentPixelRatio,
    reconstructionModel: garments.reconstructionModel,
  }).from(garments).where(and(
    eq(garments.id, garmentId),
    eq(garments.ownerId, identity.ownerId),
  )).limit(1);
  const imageKey = garment?.cutoutKey && garment.status !== "held" ? garment.cutoutKey : garment?.previewKey;
  if (!imageKey) return Response.json({ error: "garment_image_not_found" }, { status: 404 });
  const bucket = getMediaBucket();
  const object = await bucket.get(imageKey);
  if (!object) return Response.json({ error: "garment_image_not_found" }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");

  const shouldUpgradeInternetReference = garment?.sourceType === "internet"
    && garment.cutoutKey === imageKey
    && (garment.transparentPixelRatio || 0) === 0
    && garment.reconstructionModel === "retailer-product-reference";
  if (shouldUpgradeInternetReference) {
    const original = new Uint8Array(await object.arrayBuffer());
    let cleanup: ReturnType<typeof removeLightBackground> = null;
    try {
      cleanup = removeLightBackground(original, headers.get("Content-Type") || "");
    } catch {
      // Serve the safe original if this retailer codec cannot be processed locally.
    }
    if (cleanup?.applied || cleanup?.hadTransparency) {
      await Promise.all([
        bucket.put(imageKey, cleanup.png, {
          httpMetadata: { contentType: "image/png" },
          customMetadata: {
            ownerId: identity.ownerId,
            garmentId,
            purpose: "private-internet-garment-transparent-cutout",
            backgroundRemoval: cleanup.applied ? "edge-connected-light-v1" : "existing-alpha",
          },
        }),
        db.update(garments).set({
          transparentPixelRatio: cleanup.stats.transparentPixelRatio,
          reconstructionModel: cleanup.applied ? "retailer-product-reference+edge-cleanup" : "retailer-product-reference+existing-alpha",
          qaJson: JSON.stringify({
            visual: { summary: cleanup.applied ? "Fondo claro eliminado localmente, sin IA." : "La referencia ya incluía transparencia.", issues: [] },
            technical: cleanup.stats,
          }),
          updatedAt: new Date().toISOString(),
        }).where(and(eq(garments.id, garmentId), eq(garments.ownerId, identity.ownerId))),
      ]);
      const cleanHeaders = new Headers({
        "Cache-Control": "private, no-store",
        "Content-Type": "image/png",
        "Content-Length": String(cleanup.png.byteLength),
      });
      return new Response(bytesBlob(cleanup.png, "image/png"), { headers: cleanHeaders });
    }
    await db.update(garments).set({
      reconstructionModel: "retailer-product-reference+background-kept",
      updatedAt: new Date().toISOString(),
    }).where(and(eq(garments.id, garmentId), eq(garments.ownerId, identity.ownerId)));
    headers.set("Content-Length", String(original.byteLength));
    return new Response(bytesBlob(original, headers.get("Content-Type") || "application/octet-stream"), { headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

function bytesBlob(bytes: Uint8Array, contentType: string) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: contentType });
}
