import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garmentEvidence, garments, sourcePhotos } from "@/db/schema";
import { arrayBufferToBase64, extractOutputText, getImagesBinding, getOpenAIKey, OpenAIResponse } from "@/lib/openai";
import { garmentPreviewKey, getMediaBucket, normalizedPhotoKey } from "@/lib/storage";
import { isHighPrecisionCandidate } from "@/lib/inventory-precision";

type SourcePhoto = typeof sourcePhotos.$inferSelect;
export type ProcessingMode = "economy" | "quality";

export type InventoryCandidate = {
  candidate_key: string;
  name: string;
  category: string;
  type: string;
  color: string;
  material: string;
  description: string;
  confidence: number;
  is_basic: boolean;
  visibility: "clear" | "partial" | "held";
  evidence: Array<{
    photo_id: string;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
};

export type InventoryResult = { garments: InventoryCandidate[] };

export type InventoryRun = {
  garmentCount: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  rawResults: InventoryResult[];
};

export type PersistedInventoryCandidate = {
  id: string;
  candidateKey: string;
};

const inventorySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    garments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidate_key: { type: "string" },
          name: { type: "string" },
          category: {
            type: "string",
            enum: ["tops", "layers", "bottoms", "footwear", "accessories", "one_piece", "unknown"],
          },
          type: { type: "string" },
          color: { type: "string" },
          material: { type: "string" },
          description: { type: "string" },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          is_basic: { type: "boolean" },
          visibility: { type: "string", enum: ["clear", "partial", "held"] },
          evidence: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                photo_id: { type: "string" },
                bbox: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "integer", minimum: 0, maximum: 1000 },
                    y: { type: "integer", minimum: 0, maximum: 1000 },
                    width: { type: "integer", minimum: 1, maximum: 1000 },
                    height: { type: "integer", minimum: 1, maximum: 1000 },
                  },
                  required: ["x", "y", "width", "height"],
                },
              },
              required: ["photo_id", "bbox"],
            },
          },
        },
        required: ["candidate_key", "name", "category", "type", "color", "material", "description", "confidence", "is_basic", "visibility", "evidence"],
      },
    },
  },
  required: ["garments"],
} as const;

const systemPrompt = `You are the evidence-bound inventory stage of Vesta, a private personal wardrobe app.
Optimize for precision, not recall: a missed item is better than a false item. Identify only distinct physical garments whose own silhouette and garment body are clearly visible and reconstruction-ready. Return only candidates with visibility=clear and confidence at least 85; omit every uncertain, partial, held, tiny, or heavily occluded item instead of returning it.
Treat a zipped or closed outer layer as one garment. Never infer a shirt, logo garment, or other layer underneath from a small opening, collar fragment, logo, color patch, or fabric fragment. A logo visible on an outer garment belongs to that outer garment unless a separate underlying garment body and silhouette are independently visible. Never infer a bag from a strap alone; an accessory requires the actual accessory body to be clearly visible. Omit people, phones, furniture, luggage, and background objects.
Group repeated views of the same physical item within this request into one candidate with multiple evidence entries. Do not invent hidden details, brands, logos, materials, colors, or garment structure.
Set is_basic=true only for a plain, solid-color T-shirt, tank, or simple long-sleeve top with no visible logo, print, pattern, special trim, unusual cut, or other identity-bearing detail. Basic items remain inventory records but must not trigger catalog-image generation.
Bounding boxes use integer coordinates from 0 to 1000 relative to each full image. Each box must tightly cover the visible garment body and its visible silhouette. Confidence is evidence quality, not aesthetic quality. Write short Spanish names and descriptions.`;

export async function runInventory(ownerId: string, batchId: string, photos: SourcePhoto[], mode: ProcessingMode): Promise<InventoryRun> {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new InventoryError("processing_not_configured", "OpenAI processing is not configured.");

  const model = mode === "quality" ? "gpt-5.6" : "gpt-5.6-luna";
  const detail = mode === "quality" ? "original" : "high";
  const chunks = chunk(photos, 4);
  const rawResults: InventoryResult[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const photoChunk of chunks) {
    const images = await Promise.all(photoChunk.map((photo) => normalizePhoto(ownerId, batchId, photo)));
    const content: Array<Record<string, unknown>> = [{
      type: "input_text",
      text: `Photo IDs in the same order as the images: ${photoChunk.map((photo) => photo.id).join(", ")}. Return one evidence-bound inventory for these images.`,
    }];
    for (let index = 0; index < images.length; index += 1) {
      content.push({ type: "input_text", text: `Photo ID: ${photoChunk[index].id}` });
      content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${arrayBufferToBase64(images[index])}`, detail });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content },
        ],
        text: { format: { type: "json_schema", name: "vesta_inventory", strict: true, schema: inventorySchema } },
      }),
    });
    const payload = await response.json() as OpenAIResponse;
    if (!response.ok) {
      throw new InventoryError("openai_request_failed", payload.error?.message || `OpenAI returned ${response.status}.`);
    }
    const outputText = extractOutputText(payload);
    if (!outputText) throw new InventoryError("openai_empty_output", "OpenAI returned no structured inventory.");
    rawResults.push(JSON.parse(outputText) as InventoryResult);
    inputTokens += payload.usage?.input_tokens ?? 0;
    outputTokens += payload.usage?.output_tokens ?? 0;
  }

  const persisted = await persistCandidates(ownerId, batchId, rawResults, new Map(photos.map((photo) => [photo.id, photo])));
  await getDb().update(sourcePhotos).set({ status: "analyzed" }).where(and(
    eq(sourcePhotos.ownerId, ownerId),
    eq(sourcePhotos.batchId, batchId),
  ));
  return { garmentCount: persisted.garmentCount, inputTokens, outputTokens, model, rawResults };
}

export async function persistExperimentalInventory(
  ownerId: string,
  batchId: string,
  photos: SourcePhoto[],
  rawResults: InventoryResult[],
) {
  const persisted = await persistCandidates(
    ownerId,
    batchId,
    rawResults,
    new Map(photos.map((photo) => [photo.id, photo])),
  );
  await getDb().update(sourcePhotos).set({ status: "analyzed" }).where(and(
    eq(sourcePhotos.ownerId, ownerId),
    eq(sourcePhotos.batchId, batchId),
  ));
  return persisted;
}

async function normalizePhoto(ownerId: string, batchId: string, photo: SourcePhoto) {
  const bucket = getMediaBucket();
  const key = photo.normalizedKey || normalizedPhotoKey(ownerId, batchId, photo.id);
  const existing = await bucket.get(key);
  if (existing) return existing.arrayBuffer();

  const original = await bucket.get(photo.r2Key);
  if (!original?.body) throw new InventoryError("source_photo_missing", `Missing source photo ${photo.id}.`);
  const transformed = await getImagesBinding().input(original.body)
    .transform({ width: 1600, height: 1600, fit: "scale-down" })
    .output({ format: "image/jpeg", quality: 82 });
  const normalizedResponse = transformed.response();
  const bytes = await normalizedResponse.arrayBuffer();
  if (!normalizedResponse.ok || !bytes.byteLength) {
    throw new InventoryError("photo_normalization_failed", `Could not normalize ${photo.id}.`);
  }
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { ownerId, batchId, photoId: photo.id, purpose: "ai-normalized" },
  });
  await getDb().update(sourcePhotos).set({ normalizedKey: key, status: "normalized" }).where(eq(sourcePhotos.id, photo.id));
  return bytes;
}

async function persistCandidates(ownerId: string, batchId: string, results: InventoryResult[], photosById: Map<string, SourcePhoto>) {
  const db = getDb();
  let garmentCount = 0;
  const persistedGarments: PersistedInventoryCandidate[] = [];
  for (const result of results) {
    for (const candidate of result.garments) {
      if (!isHighPrecisionCandidate(candidate)) continue;
      const evidence = candidate.evidence.filter((item) => photosById.has(item.photo_id));
      if (!evidence.length) continue;
      const fingerprint = fingerprintFor(candidate);
      const garmentId = `garment_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const requestedPreviewKey = garmentPreviewKey(ownerId, garmentId);
      let previewKey: string | null = null;
      try {
        await createEvidencePreview(ownerId, batchId, photosById.get(evidence[0].photo_id)!, evidence[0].bbox, requestedPreviewKey);
        previewKey = requestedPreviewKey;
      } catch {
        previewKey = null;
      }
      await db.insert(garments).values({
        id: garmentId,
        ownerId,
        batchId,
        name: candidate.name.slice(0, 100),
        category: candidate.category,
        type: candidate.type.slice(0, 80),
        color: candidate.color.slice(0, 80),
        material: candidate.material.slice(0, 80),
        description: candidate.description.slice(0, 500),
        confidence: clamp(candidate.confidence, 0, 100),
        isBasic: candidate.is_basic,
        fingerprint,
        previewKey,
        status: "candidate",
        createdAt: now,
        updatedAt: now,
      });
      garmentCount += 1;
      persistedGarments.push({ id: garmentId, candidateKey: candidate.candidate_key });
      await db.insert(garmentEvidence).values(evidence.map((item) => ({
        id: `evidence_${crypto.randomUUID()}`,
        garmentId,
        photoId: item.photo_id,
        bboxX: clamp(item.bbox.x, 0, 999),
        bboxY: clamp(item.bbox.y, 0, 999),
        bboxWidth: clamp(item.bbox.width, 1, 1000),
        bboxHeight: clamp(item.bbox.height, 1, 1000),
        confidence: clamp(candidate.confidence, 0, 100),
        createdAt: now,
      }))).onConflictDoNothing();
    }
  }
  return { garmentCount, garments: persistedGarments };
}

async function createEvidencePreview(ownerId: string, batchId: string, photo: SourcePhoto, bbox: InventoryCandidate["evidence"][number]["bbox"], previewKey: string) {
  const bucket = getMediaBucket();
  const normalizedKey = photo.normalizedKey || normalizedPhotoKey(ownerId, batchId, photo.id);
  const normalized = await bucket.get(normalizedKey);
  if (!normalized?.body) throw new InventoryError("normalized_photo_missing", `Missing normalized photo ${photo.id}.`);
  const centerX = clamp(bbox.x + bbox.width / 2, 0, 1000) / 1000;
  const centerY = clamp(bbox.y + bbox.height / 2, 0, 1000) / 1000;
  const transformed = await getImagesBinding().input(normalized.body)
    .transform({ width: 512, height: 512, fit: "cover", gravity: { x: centerX, y: centerY } })
    .output({ format: "image/jpeg", quality: 84 });
  const response = transformed.response();
  const bytes = await response.arrayBuffer();
  if (!response.ok || !bytes.byteLength) throw new InventoryError("preview_failed", `Could not create preview for ${photo.id}.`);
  await bucket.put(previewKey, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { ownerId, garmentId: previewKey.split("/").at(-2) || "", purpose: "evidence-preview" },
  });
}

function fingerprintFor(candidate: InventoryCandidate) {
  return [candidate.category, candidate.type, candidate.color, candidate.material]
    .map((value) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, ""))
    .join("|");
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export class InventoryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
