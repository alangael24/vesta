import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import {
  garmentReconstructionKey,
  getMediaBucket,
  internetGarmentKey,
} from "@/lib/storage";

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
