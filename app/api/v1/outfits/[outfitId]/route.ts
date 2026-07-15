import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { outfits } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket } from "@/lib/storage";

export async function DELETE(request: Request, { params }: { params: Promise<{ outfitId: string }> }) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  const { outfitId } = await params;
  const db = getDb();
  const [outfit] = await db.select({ id: outfits.id, renderKey: outfits.renderKey })
    .from(outfits)
    .where(and(eq(outfits.id, outfitId), eq(outfits.ownerId, identity.ownerId)))
    .limit(1);
  if (!outfit) {
    return Response.json({ error: "outfit_not_found" }, { status: 404, headers: privateHeaders() });
  }

  await db.delete(outfits).where(and(eq(outfits.id, outfitId), eq(outfits.ownerId, identity.ownerId)));
  if (outfit.renderKey) {
    try {
      await getMediaBucket().delete(outfit.renderKey);
    } catch {
      // The database deletion is authoritative; orphan cleanup can be retried later.
    }
  }

  return Response.json({ deleted: true, outfitId }, { headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
