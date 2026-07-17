import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { garmentEvidence, garments, outfitItems, outfits, users } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { parsePiecesSnapshot, snapshotGarment } from "@/lib/outfit-snapshot";
import {
  type OutfitContext,
  type OutfitMood,
  type OutfitStyleReference,
  type OutfitWeather,
  signatureFor,
  suggestOutfits,
} from "@/lib/outfit-suggestions";

const weatherOptions: OutfitWeather[] = ["calor", "templado", "frío", "lluvia"];
const moodOptions: OutfitMood[] = ["minimal", "relajado", "pulido", "atrevido"];

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
    isBasic: garments.isBasic,
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
  const wardrobeById = new Map(wardrobe.map((garment) => [garment.id, garment]));
  const requestedGarmentIds = Array.isArray(body?.garmentIds)
    ? Array.from(new Set(body.garmentIds.filter((id): id is string => typeof id === "string" && id.length > 0)))
    : null;

  if (requestedGarmentIds) {
    if (!requestedGarmentIds.length || requestedGarmentIds.length > 6) {
      return Response.json({ error: "outfit_garments_invalid" }, { status: 400, headers: privateHeaders() });
    }
    const selectedGarments = requestedGarmentIds
      .map((garmentId) => wardrobeById.get(garmentId))
      .filter((garment): garment is NonNullable<typeof garment> => Boolean(garment));
    if (selectedGarments.length !== requestedGarmentIds.length) {
      return Response.json({ error: "outfit_garment_unavailable" }, { status: 409, headers: privateHeaders() });
    }

    const requestedSignature = signatureFor(requestedGarmentIds);
    const existingOutfitId = Array.from(existingByOutfit.entries())
      .find(([, garmentIds]) => signatureFor(garmentIds) === requestedSignature)?.[0];
    if (existingOutfitId) {
      return Response.json({
        outfits: await listOwnerOutfits(identity.ownerId),
        created: 0,
        selectedOutfitId: existingOutfitId,
      }, { headers: privateHeaders() });
    }

    const [owner] = await db.select({ avatarVersion: users.avatarVersion }).from(users)
      .where(eq(users.id, identity.ownerId)).limit(1);
    const outfitId = crypto.randomUUID();
    await db.insert(outfits).values({
      id: outfitId,
      ownerId: identity.ownerId,
      name: cleanLabel(body?.name, 80) || manualOutfitName(selectedGarments),
      occasion: cleanLabel(body?.occasion, 40) || "Creado por ti",
      rationale: cleanLabel(body?.rationale, 240)
        || `Combinación creada en el probador con ${selectedGarments.length} ${selectedGarments.length === 1 ? "prenda" : "prendas"}.`,
      piecesSnapshotJson: JSON.stringify(selectedGarments.map(snapshotGarment)),
      avatarVersion: owner?.avatarVersion || null,
      status: "saved",
      updatedAt: new Date().toISOString(),
    });
    await db.insert(outfitItems).values(requestedGarmentIds.map((garmentId, position) => ({ outfitId, garmentId, position })));
    return Response.json({
      outfits: await listOwnerOutfits(identity.ownerId),
      created: 1,
      createdOutfitIds: [outfitId],
      selectedOutfitId: outfitId,
    }, { status: 201, headers: privateHeaders() });
  }

  const context = parseOutfitContext(body, wardrobeById);
  if (context instanceof Response) return context;

  const photoEvidenceRows = await db.select({
    photoId: garmentEvidence.photoId,
    garmentId: garmentEvidence.garmentId,
  }).from(garmentEvidence)
    .innerJoin(garments, eq(garments.id, garmentEvidence.garmentId))
    .where(eq(garments.ownerId, identity.ownerId));
  const garmentsByPhoto = new Map<string, string[]>();
  for (const row of photoEvidenceRows) {
    const ids = garmentsByPhoto.get(row.photoId) || [];
    ids.push(row.garmentId);
    garmentsByPhoto.set(row.photoId, ids);
  }
  const styleReferences: OutfitStyleReference[] = [
    ...Array.from(garmentsByPhoto.values()).map((ids) => ({ source: "photo" as const, garments: ids.map((id) => wardrobeById.get(id)).filter(Boolean) })),
    ...Array.from(existingByOutfit.values()).map((ids) => ({ source: "saved_look" as const, garments: ids.map((id) => wardrobeById.get(id)).filter(Boolean) })),
  ].filter((reference) => reference.garments.length >= 2) as OutfitStyleReference[];
  const suggestions = suggestOutfits(wardrobe, count, existingSignatures, styleReferences, context);
  if (!suggestions.length) {
    return Response.json({
      error: wardrobe.length < 2 ? "outfit_wardrobe_too_small" : "outfit_combinations_exhausted",
      outfits: await listOwnerOutfits(identity.ownerId),
    }, { status: 409, headers: privateHeaders() });
  }

  const [owner] = await db.select({ avatarVersion: users.avatarVersion }).from(users)
    .where(eq(users.id, identity.ownerId)).limit(1);

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
    context,
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
    isBasic: garments.isBasic,
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
      isBasic: row.isBasic,
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

type OutfitRequest = {
  count?: number;
  garmentIds?: unknown;
  name?: unknown;
  occasion?: unknown;
  rationale?: unknown;
  weather?: unknown;
  mood?: unknown;
  seedGarmentIds?: unknown;
  avoidGarmentIds?: unknown;
  variationSeed?: unknown;
};

async function safeJson(request: Request): Promise<OutfitRequest | null> {
  try {
    return await request.json() as OutfitRequest;
  } catch {
    return null;
  }
}

function parseOutfitContext(
  body: OutfitRequest | null,
  wardrobeById: Map<string, unknown>,
): OutfitContext | Response {
  const seedGarmentIds = cleanIdList(body?.seedGarmentIds, 2);
  const avoidGarmentIds = cleanIdList(body?.avoidGarmentIds, 12);
  if (seedGarmentIds === null || avoidGarmentIds === null) {
    return Response.json({ error: "outfit_context_invalid" }, { status: 400, headers: privateHeaders() });
  }

  if (seedGarmentIds.some((id) => avoidGarmentIds.includes(id))) {
    return Response.json({ error: "outfit_context_conflict" }, { status: 400, headers: privateHeaders() });
  }

  const unavailable = [...seedGarmentIds, ...avoidGarmentIds].filter((id) => !wardrobeById.has(id));
  if (unavailable.length) {
    return Response.json({ error: "outfit_context_garment_unavailable", garmentIds: unavailable }, { status: 409, headers: privateHeaders() });
  }

  if (body?.weather !== undefined && !weatherOptions.includes(body.weather as OutfitWeather)) {
    return Response.json({ error: "outfit_weather_invalid" }, { status: 400, headers: privateHeaders() });
  }
  if (body?.mood !== undefined && !moodOptions.includes(body.mood as OutfitMood)) {
    return Response.json({ error: "outfit_mood_invalid" }, { status: 400, headers: privateHeaders() });
  }

  const weather = body?.weather as OutfitWeather | undefined;
  const mood = body?.mood as OutfitMood | undefined;
  const variationSeed = Number(body?.variationSeed);

  return {
    occasion: cleanLabel(body?.occasion, 40) || undefined,
    weather,
    mood,
    seedGarmentIds,
    avoidGarmentIds,
    variationSeed: Number.isFinite(variationSeed) ? Math.trunc(variationSeed) : undefined,
  };
}

function cleanIdList(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const ids = Array.from(new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0)));
  return ids.length <= maxLength ? ids : null;
}

function cleanLabel(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function manualOutfitName(selectedGarments: Array<{ color: string | null; type: string; name: string }>) {
  const descriptors = selectedGarments.map((garment) => {
    const color = (garment.color || "").trim();
    return color && !/sin confirmar|unknown/iu.test(color) ? color : garment.type || garment.name;
  });
  const uniqueDescriptors = Array.from(new Set(descriptors.filter(Boolean))).slice(0, 2);
  return uniqueDescriptors.length ? `Mi look · ${uniqueDescriptors.join(" + ")}` : "Mi look";
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
