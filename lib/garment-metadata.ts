export const garmentCategories = ["tops", "layers", "bottoms", "footwear", "accessories", "one_piece"] as const;

export type GarmentCategory = typeof garmentCategories[number];

export type GarmentMetadata = {
  name: string;
  category: GarmentCategory;
  color: string;
  secondaryColor: string | null;
  tags: string[];
};

export function normalizeGarmentMetadata(value: unknown): GarmentMetadata | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const name = cleanText(input.name, 100);
  const category = typeof input.category === "string" && garmentCategories.includes(input.category as GarmentCategory)
    ? input.category as GarmentCategory
    : null;
  const color = cleanText(input.color, 60);
  const secondaryColor = input.secondaryColor === null || input.secondaryColor === undefined || input.secondaryColor === ""
    ? null
    : cleanText(input.secondaryColor, 60);
  const tags = normalizeTags(input.tags);
  if (!name || !category || !color || secondaryColor === undefined || !tags) return null;
  return { name, category, color, secondaryColor, tags };
}

export function parseGarmentTags(value: string | null) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return normalizeTags(parsed) || [];
  } catch {
    return [];
  }
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value) || value.length > 12) return null;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const tag = cleanText(entry, 30);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function cleanText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned ? cleaned.slice(0, maximumLength) : null;
}
