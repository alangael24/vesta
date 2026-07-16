import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments, outfits } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { normalizeGarmentMetadata } from "@/lib/garment-metadata";
import {
  garmentReconstructionKey,
  getMediaBucket,
  internetGarmentKey,
} from "@/lib/storage";

export async function PATCH(request: Request, { params }: { params: Promise<{ garmentId: string }> }) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  const metadata = normalizeGarmentMetadata(await request.json().catch(() => null));
  if (!metadata) {
    return Response.json({ error: "garment_metadata_invalid" }, { status: 400, headers: privateHeaders() });
  }

  const { garmentId } = await params;
  const db = getDb();
  const [garment] = await db.select({ id: garments.id }).from(garments)
    .where(and(eq(garments.id, garmentId), eq(garments.ownerId, identity.ownerId)))
    .limit(1);
  if (!garment) {
    return Response.json({ error: "garment_not_found" }, { status: 404, headers: privateHeaders() });
  }

  const now = new Date().toISOString();
  await db.update(garments).set({
    name: metadata.name,
    category: metadata.category,
    color: metadata.color,
    secondaryColor: metadata.secondaryColor,
    tagsJson: JSON.stringify(metadata.tags),
    updatedAt: now,
  }).where(and(eq(garments.id, garmentId), eq(garments.ownerId, identity.ownerId)));

  const savedOutfits = await db.select({ id: outfits.id, piecesSnapshotJson: outfits.piecesSnapshotJson })
    .from(outfits).where(eq(outfits.ownerId, identity.ownerId));
  for (const outfit of savedOutfits) {
    const nextSnapshot = updateSnapshot(outfit.piecesSnapshotJson, garmentId, metadata);
    if (nextSnapshot) {
      await db.update(outfits).set({ piecesSnapshotJson: nextSnapshot, updatedAt: now })
        .where(and(eq(outfits.id, outfit.id), eq(outfits.ownerId, identity.ownerId)));
    }
  }

  return Response.json({ garment: { id: garmentId, ...metadata, updatedAt: now } }, { headers: privateHeaders() });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ garmentId: string }> }) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  const { garmentId } = await params;
  const db = getDb();
  const [garment] = await db.select({
    id: garments.id,
    cutoutKey: garments.cutoutKey,
    previewKey: garments.previewKey,
  }).from(garments)
    .where(and(eq(garments.id, garmentId), eq(garments.ownerId, identity.ownerId)))
    .limit(1);

  if (!garment) {
    return Response.json({ error: "garment_not_found" }, { status: 404, headers: privateHeaders() });
  }

  await db.delete(garments).where(and(eq(garments.id, garmentId), eq(garments.ownerId, identity.ownerId)));

  const mediaKeys = Array.from(new Set([
    garment.cutoutKey,
    garment.previewKey,
    garmentReconstructionKey(identity.ownerId, garmentId),
    internetGarmentKey(identity.ownerId, garmentId),
  ].filter((key): key is string => Boolean(key))));
  if (mediaKeys.length) {
    try {
      await getMediaBucket().delete(mediaKeys);
    } catch {
      // The database deletion is authoritative; orphan cleanup can be retried later.
    }
  }

  return Response.json({ deleted: true, garmentId }, { headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}

function updateSnapshot(raw: string | null, garmentId: string, metadata: ReturnType<typeof normalizeGarmentMetadata>) {
  if (!raw || !metadata) return null;
  try {
    const pieces = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(pieces) || !pieces.some((piece) => piece.id === garmentId)) return null;
    return JSON.stringify(pieces.map((piece) => piece.id === garmentId ? {
      ...piece,
      name: metadata.name,
      category: metadata.category,
      color: metadata.color,
    } : piece));
  } catch {
    return null;
  }
}
