import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { garments, outfitItems, outfits, users } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { parsePiecesSnapshot, snapshotGarment } from "@/lib/outfit-snapshot";
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
    material: garments.material,
    description: garments.description,
    sourceType: garments.sourceType,
    sourceUrl: garments.sourceUrl,
    confidence: garments.confidence,
    status: garments.status,
    cutoutKey: garments.cutoutKey,
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

  const [owner] = await db.select({ avatarVersion: users.avatarVersion }).from(users)
    .where(eq(users.id, identity.ownerId)).limit(1);
  const wardrobeById = new Map(wardrobe.map((garment) => [garment.id, garment]));

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
      piecesSnapshotJson: JSON.stringify(suggestion.garmentIds
        .map((garmentId) => wardrobeById.get(garmentId))
        .filter((garment): garment is NonNullable<typeof garment> => Boolean(garment))
        .map(snapshotGarment)),
      avatarVersion: owner?.avatarVersion || null,
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
  const db = getDb();
  const outfitRows = await db.select({
    id: outfits.id,
    name: outfits.name,
    occasion: outfits.occasion,
    rationale: outfits.rationale,
    renderKey: outfits.renderKey,
    piecesSnapshotJson: outfits.piecesSnapshotJson,
    avatarVersion: outfits.avatarVersion,
    status: outfits.status,
    createdAt: outfits.createdAt,
    updatedAt: outfits.updatedAt,
  }).from(outfits)
    .where(eq(outfits.ownerId, ownerId))
    .orderBy(desc(outfits.createdAt));

  const outfitIds = outfitRows.map((outfit) => outfit.id);
  const rows = outfitIds.length ? await db.select({
    outfitId: outfitItems.outfitId,
    position: outfitItems.position,
    garmentId: garments.id,
    garmentName: garments.name,
    category: garments.category,
    type: garments.type,
    color: garments.color,
    material: garments.material,
    description: garments.description,
    sourceType: garments.sourceType,
    sourceUrl: garments.sourceUrl,
    confidence: garments.confidence,
    garmentStatus: garments.status,
    cutoutKey: garments.cutoutKey,
  }).from(outfitItems)
    .innerJoin(garments, eq(garments.id, outfitItems.garmentId))
    .where(inArray(outfitItems.outfitId, outfitIds))
    .orderBy(asc(outfitItems.position)) : [];

  const livePieces = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const pieces = livePieces.get(row.outfitId) || [];
    pieces.push({
      id: row.garmentId,
      name: row.garmentName,
      category: row.category,
      type: row.type,
      color: row.color || "Sin confirmar",
      material: row.material || "Sin confirmar",
      description: row.description || "Prenda de tu armario privado.",
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      confidence: row.confidence,
      status: row.garmentStatus,
      imagePath: row.cutoutKey ? `/api/v1/media/garments/${row.garmentId}` : null,
      imageKind: row.cutoutKey ? "cutout" : "evidence",
    });
    livePieces.set(row.outfitId, pieces);
  }

  return outfitRows.map((outfit) => {
    const currentPieces = livePieces.get(outfit.id) || [];
    const currentById = new Map(currentPieces.map((piece) => [String(piece.id), piece]));
    const snapshot = parsePiecesSnapshot(outfit.piecesSnapshotJson);
    const pieces = snapshot ? snapshot.map((piece) => ({
      ...piece,
      status: currentById.get(piece.id)?.status || "archived",
      imagePath: currentById.get(piece.id)?.imagePath || null,
      imageKind: currentById.get(piece.id)?.imageKind || undefined,
      sourceType: currentById.get(piece.id)?.sourceType || piece.sourceType,
      sourceUrl: currentById.get(piece.id)?.sourceUrl ?? piece.sourceUrl,
    })) : currentPieces;
    return {
      id: outfit.id,
      name: outfit.name,
      occasion: outfit.occasion,
      note: outfit.rationale,
      renderPath: outfit.renderKey ? `/api/v1/media/outfits/${outfit.id}?v=${encodeURIComponent(outfit.updatedAt)}` : null,
      avatarVersion: outfit.avatarVersion,
      status: outfit.status,
      pieces,
    };
  });
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
