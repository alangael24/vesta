import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { garments, outfitItems, outfits } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { signatureFor, suggestOutfits } from "@/lib/outfit-suggestions";

export async function GET(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  return Response.json({ outfits: await listOwnerOutfits(identity.ownerId) }, { headers: privateHeaders() });
}

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const body = await safeJson(request);
  const count = Math.max(1, Math.min(Number(body?.count) || 3, 6));
  const db = getDb();

  const wardrobe = await db.select({
    id: garments.id,
    name: garments.name,
    category: garments.category,
    type: garments.type,
    color: garments.color,
    description: garments.description,
  }).from(garments).where(and(
    eq(garments.ownerId, identity.ownerId),
    inArray(garments.status, ["candidate", "qa", "approved"]),
    isNotNull(garments.cutoutKey),
  ));

  const existingRows = await db.select({ outfitId: outfits.id, garmentId: outfitItems.garmentId })
    .from(outfits)
    .innerJoin(outfitItems, eq(outfitItems.outfitId, outfits.id))
    .where(eq(outfits.ownerId, identity.ownerId));
  const existingByOutfit = new Map<string, string[]>();
  for (const row of existingRows) {
    const ids = existingByOutfit.get(row.outfitId) || [];
    ids.push(row.garmentId);
    existingByOutfit.set(row.outfitId, ids);
  }
  const existingSignatures = new Set(Array.from(existingByOutfit.values(), signatureFor));
  const suggestions = suggestOutfits(wardrobe, count, existingSignatures);
  if (!suggestions.length) {
    return Response.json({
      error: wardrobe.length < 2 ? "outfit_wardrobe_too_small" : "outfit_combinations_exhausted",
      outfits: await listOwnerOutfits(identity.ownerId),
    }, { status: 409, headers: privateHeaders() });
  }

  const createdOutfitIds: string[] = [];
  for (const suggestion of suggestions) {
    const outfitId = crypto.randomUUID();
    createdOutfitIds.push(outfitId);
    await db.insert(outfits).values({
      id: outfitId,
      ownerId: identity.ownerId,
      name: suggestion.name,
      occasion: suggestion.occasion,
      rationale: suggestion.rationale,
      status: "saved",
      updatedAt: new Date().toISOString(),
    });
    await db.insert(outfitItems).values(suggestion.garmentIds.map((garmentId, position) => ({ outfitId, garmentId, position })));
  }

  return Response.json({
    outfits: await listOwnerOutfits(identity.ownerId),
    created: suggestions.length,
    createdOutfitIds,
  }, { status: 201, headers: privateHeaders() });
}

async function listOwnerOutfits(ownerId: string) {
  const rows = await getDb().select({
    id: outfits.id,
    name: outfits.name,
    occasion: outfits.occasion,
    rationale: outfits.rationale,
    renderKey: outfits.renderKey,
    status: outfits.status,
    createdAt: outfits.createdAt,
    position: outfitItems.position,
    garmentId: garments.id,
    garmentName: garments.name,
    category: garments.category,
    type: garments.type,
    color: garments.color,
    material: garments.material,
    description: garments.description,
    confidence: garments.confidence,
    garmentStatus: garments.status,
    cutoutKey: garments.cutoutKey,
  }).from(outfits)
    .innerJoin(outfitItems, eq(outfitItems.outfitId, outfits.id))
    .innerJoin(garments, eq(garments.id, outfitItems.garmentId))
    .where(eq(outfits.ownerId, ownerId))
    .orderBy(desc(outfits.createdAt), asc(outfitItems.position));

  const result = new Map<string, {
    id: string;
    name: string;
    occasion: string;
    note: string;
    renderPath: string | null;
    status: string;
    pieces: Array<Record<string, unknown>>;
  }>();
  for (const row of rows) {
    const outfit = result.get(row.id) || {
      id: row.id,
      name: row.name,
      occasion: row.occasion,
      note: row.rationale,
      renderPath: row.renderKey ? `/api/v1/media/outfits/${row.id}` : null,
      status: row.status,
      pieces: [],
    };
    outfit.pieces.push({
      id: row.garmentId,
      name: row.garmentName,
      category: row.category,
      type: row.type,
      color: row.color || "Sin confirmar",
      material: row.material || "Sin confirmar",
      description: row.description || "Prenda de tu armario privado.",
      confidence: row.confidence,
      status: row.garmentStatus,
      imagePath: row.cutoutKey ? `/api/v1/media/garments/${row.garmentId}` : null,
      imageKind: row.cutoutKey ? "cutout" : "evidence",
    });
    result.set(row.id, outfit);
  }
  return Array.from(result.values());
}

async function safeJson(request: Request): Promise<{ count?: number } | null> {
  try {
    return await request.json() as { count?: number };
  } catch {
    return null;
  }
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
