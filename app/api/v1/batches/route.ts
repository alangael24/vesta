import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { importBatches, sourcePhotos } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { originalPhotoKey } from "@/lib/storage";

type PhotoManifest = {
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
};

const allowedTypes = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]);
const maxPhotoBytes = 25 * 1024 * 1024;
const maxBatchBytes = 500 * 1024 * 1024;

export async function GET(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  const rows = await getDb().select().from(importBatches)
    .where(eq(importBatches.ownerId, identity.ownerId))
    .orderBy(desc(importBatches.createdAt))
    .limit(20);
  return Response.json({ batches: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  const payload = await safeJson(request);
  const photos = payload?.photos;
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 40) {
    return Response.json({ error: "photos_must_contain_1_to_40_items" }, { status: 400 });
  }

  const normalized = photos.map(normalizePhoto);
  if (normalized.some((photo) => !photo)) {
    return Response.json({ error: "invalid_photo_manifest" }, { status: 400 });
  }
  const validPhotos = normalized as Array<Required<Pick<PhotoManifest, "filename" | "contentType" | "sizeBytes">> & Pick<PhotoManifest, "width" | "height">>;
  const totalBytes = validPhotos.reduce((total, photo) => total + photo.sizeBytes, 0);
  if (totalBytes > maxBatchBytes) {
    return Response.json({ error: "batch_too_large" }, { status: 413 });
  }

  const db = getDb();
  const batchId = `batch_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const photoRows = validPhotos.map((photo) => {
    const id = `photo_${crypto.randomUUID()}`;
    return {
      id,
      ownerId: identity.ownerId,
      batchId,
      r2Key: originalPhotoKey(identity.ownerId, batchId, id),
      filename: photo.filename,
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      width: photo.width ?? null,
      height: photo.height ?? null,
      status: "awaiting_upload" as const,
      createdAt: now,
    };
  });

  await db.batch([
    db.insert(importBatches).values({
      id: batchId,
      ownerId: identity.ownerId,
      deviceId: identity.deviceId,
      photoCount: photoRows.length,
      totalBytes,
      status: "uploading",
      originalsPolicy: payload?.originalsPolicy === "delete_after_extraction" ? "delete_after_extraction" : "retain_private",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(sourcePhotos).values(photoRows),
  ]);

  return Response.json({
    batchId,
    photos: photoRows.map((photo) => ({
      id: photo.id,
      uploadPath: `/api/v1/batches/${batchId}/photos/${photo.id}`,
    })),
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

function normalizePhoto(photo: PhotoManifest) {
  const filename = photo.filename?.trim().slice(0, 180);
  const contentType = photo.contentType?.toLowerCase();
  const sizeBytes = Number(photo.sizeBytes);
  if (!filename || !contentType || !allowedTypes.has(contentType)) return null;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxPhotoBytes) return null;
  return {
    filename,
    contentType,
    sizeBytes,
    width: positiveInteger(photo.width),
    height: positiveInteger(photo.height),
  };
}

function positiveInteger(value?: number) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

async function safeJson(request: Request): Promise<{ photos?: PhotoManifest[]; originalsPolicy?: string } | null> {
  try {
    return await request.json() as { photos?: PhotoManifest[]; originalsPolicy?: string };
  } catch {
    return null;
  }
}
