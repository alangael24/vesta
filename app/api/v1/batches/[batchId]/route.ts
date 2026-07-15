import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { importBatches, processingJobs, sourcePhotos } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";

type RouteContext = { params: Promise<{ batchId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { batchId } = await context.params;
  const [batch] = await getDb().select().from(importBatches).where(and(
    eq(importBatches.id, batchId),
    eq(importBatches.ownerId, identity.ownerId),
  )).limit(1);
  if (!batch) return Response.json({ error: "batch_not_found" }, { status: 404 });
  const jobs = await getDb().select().from(processingJobs).where(and(
    eq(processingJobs.batchId, batchId),
    eq(processingJobs.ownerId, identity.ownerId),
  ));
  const photos = await getDb().select({
    id: sourcePhotos.id,
    filename: sourcePhotos.filename,
    contentType: sourcePhotos.contentType,
    sizeBytes: sourcePhotos.sizeBytes,
    width: sourcePhotos.width,
    height: sourcePhotos.height,
    status: sourcePhotos.status,
  }).from(sourcePhotos).where(and(
    eq(sourcePhotos.batchId, batchId),
    eq(sourcePhotos.ownerId, identity.ownerId),
  ));
  return Response.json({
    batch,
    jobs,
    photos: photos.map((photo) => ({ ...photo, downloadPath: `/api/v1/media/photos/${photo.id}` })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
