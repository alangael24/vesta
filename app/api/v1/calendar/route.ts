import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { outfits, scheduledOutfits } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";

export async function GET(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  return Response.json({ entries: await listCalendar(identity.ownerId) }, { headers: privateHeaders() });
}

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const body = await safeJson(request);
  const outfitId = typeof body?.outfitId === "string" ? body.outfitId.trim() : "";
  const scheduledDate = typeof body?.scheduledDate === "string" ? body.scheduledDate.trim() : "";
  if (!outfitId || !isCalendarDate(scheduledDate)) {
    return failure("calendar_entry_invalid", 400);
  }

  const db = getDb();
  const [ownedOutfit] = await db.select({ id: outfits.id }).from(outfits).where(and(
    eq(outfits.id, outfitId),
    eq(outfits.ownerId, identity.ownerId),
  )).limit(1);
  if (!ownedOutfit) return failure("outfit_not_found", 404);

  const [existing] = await db.select({ id: scheduledOutfits.id }).from(scheduledOutfits).where(and(
    eq(scheduledOutfits.ownerId, identity.ownerId),
    eq(scheduledOutfits.outfitId, outfitId),
    eq(scheduledOutfits.scheduledDate, scheduledDate),
  )).limit(1);
  if (existing) {
    return Response.json({ entries: await listCalendar(identity.ownerId), selectedEntryId: existing.id }, { headers: privateHeaders() });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(scheduledOutfits).values({
    id,
    ownerId: identity.ownerId,
    outfitId,
    scheduledDate,
    note: cleanNote(body?.note),
    updatedAt: now,
  });
  return Response.json({ entries: await listCalendar(identity.ownerId), selectedEntryId: id }, { status: 201, headers: privateHeaders() });
}

async function listCalendar(ownerId: string) {
  return getDb().select({
    id: scheduledOutfits.id,
    outfitId: scheduledOutfits.outfitId,
    scheduledDate: scheduledOutfits.scheduledDate,
    note: scheduledOutfits.note,
    createdAt: scheduledOutfits.createdAt,
  }).from(scheduledOutfits)
    .where(eq(scheduledOutfits.ownerId, ownerId))
    .orderBy(asc(scheduledOutfits.scheduledDate), asc(scheduledOutfits.createdAt));
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function cleanNote(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned ? cleaned.slice(0, 180) : null;
}

async function safeJson(request: Request): Promise<{ outfitId?: unknown; scheduledDate?: unknown; note?: unknown } | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: privateHeaders() });
}
