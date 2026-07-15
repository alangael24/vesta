import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { outfits } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket, outfitRenderKey } from "@/lib/storage";

type RouteContext = { params: Promise<{ outfitId: string }> };

const maximumImageBytes = 15 * 1024 * 1024;

export async function PUT(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  if (request.headers.get("content-type")?.toLowerCase() !== "image/png") {
    return Response.json({ error: "png_required" }, { status: 400 });
  }
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maximumImageBytes) {
    return Response.json({ error: "outfit_render_too_large" }, { status: 413 });
  }

  const { outfitId } = await context.params;
  const db = getDb();
  const [outfit] = await db.select({ id: outfits.id }).from(outfits).where(and(
    eq(outfits.id, outfitId),
    eq(outfits.ownerId, identity.ownerId),
  )).limit(1);
  if (!outfit) return Response.json({ error: "outfit_not_found" }, { status: 404 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > maximumImageBytes) {
    return Response.json({ error: "invalid_outfit_render" }, { status: 400 });
  }

  const key = outfitRenderKey(identity.ownerId, outfitId);
  await getMediaBucket().put(key, bytes, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { ownerId: identity.ownerId, outfitId, purpose: "private-virtual-try-on-render" },
  });
  await db.update(outfits).set({
    renderKey: key,
    status: "ready",
    updatedAt: new Date().toISOString(),
  }).where(and(eq(outfits.id, outfitId), eq(outfits.ownerId, identity.ownerId)));

  return Response.json({
    ok: true,
    renderPath: `/api/v1/media/outfits/${outfitId}`,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
