import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { garmentEvidence, garments } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";

export async function GET(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  const rows = await getDb().select({
    id: garments.id,
    name: garments.name,
    category: garments.category,
    type: garments.type,
    color: garments.color,
    material: garments.material,
    description: garments.description,
    confidence: garments.confidence,
    status: garments.status,
    reconstructionQuality: garments.reconstructionQuality,
    transparentPixelRatio: garments.transparentPixelRatio,
    qaStatus: garments.qaStatus,
    qaJson: garments.qaJson,
    cutoutKey: garments.cutoutKey,
    previewKey: garments.previewKey,
    photoId: garmentEvidence.photoId,
  }).from(garments)
    .leftJoin(garmentEvidence, eq(garmentEvidence.garmentId, garments.id))
    .where(and(
      eq(garments.ownerId, identity.ownerId),
      inArray(garments.status, ["candidate", "reconstructing", "qa", "approved", "held"]),
    ))
    .orderBy(desc(garments.createdAt));

  const unique = new Map<string, typeof rows[number]>();
  for (const row of rows) if (!unique.has(row.id)) unique.set(row.id, row);
  const [duplicates] = await getDb().select({ count: count() }).from(garments).where(and(
    eq(garments.ownerId, identity.ownerId),
    eq(garments.status, "duplicate"),
  ));
  return Response.json({
    garments: Array.from(unique.values()).map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      type: row.type,
      color: row.color || "Sin confirmar",
      material: row.material || "Sin confirmar",
      description: row.description || "Prenda detectada en tus fotos.",
      confidence: row.confidence,
      status: row.status,
      reconstructionQuality: row.reconstructionQuality,
      transparentPixelRatio: row.transparentPixelRatio,
      qaStatus: row.qaStatus,
      qaSummary: qaSummary(row.qaJson),
      imagePath: row.cutoutKey || row.previewKey ? `/api/v1/media/garments/${row.id}` : row.photoId ? `/api/v1/media/photos/${row.photoId}` : null,
      imageKind: row.cutoutKey && row.status !== "held" ? "cutout" : "evidence",
    })),
    duplicateCount: duplicates?.count ?? 0,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

function qaSummary(value: string | null) {
  try {
    const parsed = JSON.parse(value || "{}") as { visual?: { summary?: string; issues?: string[] } };
    return { summary: parsed.visual?.summary || null, issues: parsed.visual?.issues || [] };
  } catch {
    return { summary: null, issues: [] };
  }
}
