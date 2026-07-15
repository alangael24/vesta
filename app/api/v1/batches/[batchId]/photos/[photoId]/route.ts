import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { importBatches, processingJobs, sourcePhotos } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket } from "@/lib/storage";

type RouteContext = { params: Promise<{ batchId: string; photoId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  const { batchId, photoId } = await context.params;
  const db = getDb();
  const [photo] = await db.select().from(sourcePhotos).where(and(
    eq(sourcePhotos.id, photoId),
    eq(sourcePhotos.batchId, batchId),
    eq(sourcePhotos.ownerId, identity.ownerId),
  )).limit(1);

  if (!photo) return Response.json({ error: "photo_not_found" }, { status: 404 });
  if (!request.body) return Response.json({ error: "photo_body_required" }, { status: 400 });
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (contentType !== photo.contentType) {
    return Response.json({ error: "content_type_mismatch" }, { status: 400 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > photo.sizeBytes + 1024) {
    return Response.json({ error: "photo_too_large" }, { status: 413 });
  }

  await getMediaBucket().put(photo.r2Key, request.body, {
    httpMetadata: { contentType: photo.contentType },
    customMetadata: { ownerId: identity.ownerId, batchId, photoId },
  });

  const now = new Date().toISOString();
  await db.update(sourcePhotos).set({ status: "uploaded", uploadedAt: now })
    .where(eq(sourcePhotos.id, photoId));

  const pending = await db.select({ id: sourcePhotos.id }).from(sourcePhotos).where(and(
    eq(sourcePhotos.batchId, batchId),
    eq(sourcePhotos.status, "awaiting_upload"),
  )).limit(1);

  if (!pending.length) {
    await db.batch([
      db.update(importBatches).set({ status: "uploaded", updatedAt: now }).where(and(
        eq(importBatches.id, batchId),
        eq(importBatches.ownerId, identity.ownerId),
      )),
      db.insert(processingJobs).values({
        id: `job_${batchId}_inventory`,
        ownerId: identity.ownerId,
        batchId,
        kind: "inventory",
        status: "waiting_review",
        progress: 0,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing(),
    ]);
  }

  return Response.json({ ok: true, batchReady: !pending.length }, { headers: { "Cache-Control": "no-store" } });
}
