import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { scheduledOutfits } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";

export async function DELETE(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { entryId } = await params;
  const db = getDb();
  const [entry] = await db.select({ id: scheduledOutfits.id }).from(scheduledOutfits).where(and(
    eq(scheduledOutfits.id, entryId),
    eq(scheduledOutfits.ownerId, identity.ownerId),
  )).limit(1);
  if (!entry) {
    return Response.json({ error: "calendar_entry_not_found" }, { status: 404, headers: privateHeaders() });
  }
  await db.delete(scheduledOutfits).where(and(
    eq(scheduledOutfits.id, entryId),
    eq(scheduledOutfits.ownerId, identity.ownerId),
  ));
  return Response.json({ deleted: true, entryId }, { headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
