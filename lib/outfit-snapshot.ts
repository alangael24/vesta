export type OutfitPieceSnapshot = {
  id: string;
  name: string;
  category: string;
  type: string;
  color: string;
  material: string;
  description: string;
  confidence: number | null;
  sourceType?: "photos" | "internet";
  sourceUrl?: string | null;
};

export function snapshotGarment(garment: {
  id: string;
  name: string;
  category: string;
  type: string;
  color: string | null;
  material: string | null;
  description: string | null;
  confidence: number | null;
  sourceType?: "photos" | "internet";
  sourceUrl?: string | null;
}): OutfitPieceSnapshot {
  return {
    id: garment.id,
    name: garment.name,
    category: garment.category,
    type: garment.type,
    color: garment.color || "Sin confirmar",
    material: garment.material || "Sin confirmar",
    description: garment.description || "Prenda de tu armario privado.",
    confidence: garment.confidence,
    sourceType: garment.sourceType,
    sourceUrl: garment.sourceUrl,
  };
}

export function parsePiecesSnapshot(raw: string | null): OutfitPieceSnapshot[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    const pieces = value.filter(isPieceSnapshot);
    return pieces.length === value.length ? pieces : null;
  } catch {
    return null;
  }
}

function isPieceSnapshot(value: unknown): value is OutfitPieceSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const requiredFieldsAreValid = ["id", "name", "category", "type", "color", "material", "description"]
    .every((key) => typeof item[key] === "string");
  const sourceTypeIsValid = item.sourceType === undefined || item.sourceType === "photos" || item.sourceType === "internet";
  const sourceUrlIsValid = item.sourceUrl === undefined || item.sourceUrl === null || typeof item.sourceUrl === "string";
  return requiredFieldsAreValid && sourceTypeIsValid && sourceUrlIsValid;
}
