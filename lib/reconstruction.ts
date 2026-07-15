import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garmentEvidence, garments, sourcePhotos } from "@/db/schema";
import { ChromaError, ChromaStats, removeChroma } from "@/lib/chroma";
import { arrayBufferToBase64, base64ToBytes, extractOutputText, getOpenAIKey, OpenAIResponse } from "@/lib/openai";
import { garmentCutoutKey, garmentReconstructionKey, getMediaBucket, normalizedPhotoKey } from "@/lib/storage";

export type ReconstructionMode = "draft" | "final";

type Evidence = {
  photoId: string;
  normalizedKey: string | null;
  batchId: string;
  bboxX: number;
  bboxY: number;
  bboxWidth: number;
  bboxHeight: number;
  confidence: number | null;
};

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
  usage?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  };
  error?: { message?: string; code?: string };
};

type VisualQa = {
  verdict: "pass" | "review" | "fail";
  identity_score: number;
  color_score: number;
  silhouette_score: number;
  detail_preservation_score: number;
  hallucination_risk: number;
  issues: string[];
  summary: string;
};

const qaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "review", "fail"] },
    identity_score: { type: "integer", minimum: 0, maximum: 100 },
    color_score: { type: "integer", minimum: 0, maximum: 100 },
    silhouette_score: { type: "integer", minimum: 0, maximum: 100 },
    detail_preservation_score: { type: "integer", minimum: 0, maximum: 100 },
    hallucination_risk: { type: "integer", minimum: 0, maximum: 100 },
    issues: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["verdict", "identity_score", "color_score", "silhouette_score", "detail_preservation_score", "hallucination_risk", "issues", "summary"],
} as const;

export async function reconstructAndVerify(ownerId: string, garmentId: string, mode: ReconstructionMode) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new ReconstructionError("processing_not_configured", "OpenAI processing is not configured.");
  const db = getDb();
  const [garment] = await db.select().from(garments).where(and(
    eq(garments.id, garmentId),
    eq(garments.ownerId, ownerId),
  )).limit(1);
  if (!garment) throw new ReconstructionError("garment_not_found", "Garment not found.");
  const evidence = await db.select({
    photoId: sourcePhotos.id,
    normalizedKey: sourcePhotos.normalizedKey,
    batchId: sourcePhotos.batchId,
    bboxX: garmentEvidence.bboxX,
    bboxY: garmentEvidence.bboxY,
    bboxWidth: garmentEvidence.bboxWidth,
    bboxHeight: garmentEvidence.bboxHeight,
    confidence: garmentEvidence.confidence,
  }).from(garmentEvidence)
    .innerJoin(sourcePhotos, eq(sourcePhotos.id, garmentEvidence.photoId))
    .where(eq(garmentEvidence.garmentId, garmentId))
    .orderBy(desc(garmentEvidence.confidence))
    .limit(4);
  if (!evidence.length) throw new ReconstructionError("garment_evidence_missing", "No evidence is available for this garment.");

  const references = await loadEvidence(ownerId, evidence);
  const chroma = chromaFor(garment.color || "");
  const form = new FormData();
  form.set("model", "gpt-image-2");
  form.set("prompt", reconstructionPrompt(garment, evidence, chroma));
  form.set("quality", mode === "final" ? "high" : "low");
  form.set("size", "1024x1024");
  form.set("output_format", "png");
  form.set("background", "opaque");
  for (let index = 0; index < references.length; index += 1) {
    form.append("image[]", new Blob([references[index]], { type: "image/jpeg" }), `evidence-${index + 1}.jpg`);
  }

  const imageResponse = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const imagePayload = await imageResponse.json() as ImageResponse;
  if (!imageResponse.ok) {
    throw new ReconstructionError(imagePayload.error?.code || "reconstruction_request_failed", imagePayload.error?.message || `OpenAI returned ${imageResponse.status}.`);
  }
  const encodedImage = imagePayload.data?.[0]?.b64_json;
  if (!encodedImage) throw new ReconstructionError("reconstruction_empty_output", "The image model returned no image.");
  const opaquePng = base64ToBytes(encodedImage);
  let cutout: ReturnType<typeof removeChroma>;
  try {
    cutout = removeChroma(opaquePng, chroma.rgb);
  } catch (error) {
    if (error instanceof ChromaError) throw new ReconstructionError(error.code, error.message);
    throw error;
  }
  const { png: cutoutPng, stats } = cutout;

  const bucket = getMediaBucket();
  const reconstructionKey = garmentReconstructionKey(ownerId, garmentId);
  const cutoutKey = garmentCutoutKey(ownerId, garmentId);
  await Promise.all([
    bucket.put(reconstructionKey, opaquePng, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { ownerId, garmentId, purpose: "evidence-bound-reconstruction" },
    }),
    bucket.put(cutoutKey, cutoutPng, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { ownerId, garmentId, purpose: "transparent-cutout" },
    }),
  ]);

  const qa = await runVisualQa(apiKey, garment, references, cutoutPng, stats, mode);
  const technicalPass = stats.transparentPixelRatio >= 12 && stats.transparentPixelRatio <= 92 && stats.foregroundPixelRatio >= 6;
  const visualPass = qa.verdict === "pass" && qa.identity_score >= 82 && qa.color_score >= 80 && qa.silhouette_score >= 80 && qa.hallucination_risk <= 18;
  const finalStatus = technicalPass && visualPass ? "approved" : qa.verdict === "fail" || !technicalPass ? "held" : "qa";
  const qaStatus = technicalPass && visualPass ? "pass" : qa.verdict === "fail" || !technicalPass ? "fail" : "review";
  const now = new Date().toISOString();
  await db.update(garments).set({
    cutoutKey,
    reconstructionModel: "gpt-image-2",
    reconstructionQuality: mode,
    reconstructedAt: now,
    cutoutWidth: stats.width,
    cutoutHeight: stats.height,
    transparentPixelRatio: stats.transparentPixelRatio,
    qaStatus,
    qaJson: JSON.stringify({ technical: stats, visual: qa }),
    status: finalStatus,
    updatedAt: now,
  }).where(and(eq(garments.id, garmentId), eq(garments.ownerId, ownerId)));

  return {
    status: finalStatus,
    qaStatus,
    technical: stats,
    visual: qa,
    imageModel: "gpt-image-2",
    qaModel: mode === "final" ? "gpt-5.6-terra" : "gpt-5.6-luna",
    imageUsage: imagePayload.usage || null,
  };
}

async function loadEvidence(ownerId: string, evidence: Evidence[]) {
  const bucket = getMediaBucket();
  const images: ArrayBuffer[] = [];
  for (const item of evidence) {
    const key = item.normalizedKey || normalizedPhotoKey(ownerId, item.batchId, item.photoId);
    const object = await bucket.get(key);
    if (object) images.push(await object.arrayBuffer());
  }
  if (!images.length) throw new ReconstructionError("normalized_evidence_missing", "Normalized evidence images are unavailable.");
  return images;
}

function reconstructionPrompt(garment: typeof garments.$inferSelect, evidence: Evidence[], chroma: Chroma) {
  const boxes = evidence.map((item, index) => `Image ${index + 1}: target box x=${item.bboxX}, y=${item.bboxY}, width=${item.bboxWidth}, height=${item.bboxHeight} on a 0-1000 coordinate grid.`).join("\n");
  return `GOAL: Create one evidence-bound ecommerce reconstruction of the exact garment identified below, using only the supplied photos as visual evidence.
TARGET: ${garment.name}; category ${garment.category}; type ${garment.type}; observed color ${garment.color || "uncertain"}; observed material ${garment.material || "uncertain"}.
EVIDENCE LOCATIONS:\n${boxes}
COMPOSITION: One isolated garment only, centered, fully visible, front-facing neutral product presentation, realistic natural fabric shape, no crop, no person, no mannequin, no hanger, no props, no text outside the garment.
BACKGROUND: perfectly flat uniform ${chroma.name} chroma background, exact RGB ${chroma.rgb.join(",")}, edge to edge, no shadow, no gradient, no texture.
PRESERVE: visible cut, proportions, seams, fasteners, pockets, wash, pattern, texture, wear marks, and readable design details from the evidence.
DO NOT INVENT: hidden construction, brand, logo, text, print, pocket, button, zipper, color, material, or decoration. If an unreadable mark exists, preserve its visible shape without interpreting it. Do not combine different garments visible in the photos.`;
}

async function runVisualQa(apiKey: string, garment: typeof garments.$inferSelect, references: ArrayBuffer[], cutout: Uint8Array, technical: ChromaStats, mode: ReconstructionMode) {
  const content: Array<Record<string, unknown>> = [{
    type: "input_text",
    text: `Verify whether the final transparent PNG faithfully reconstructs this exact candidate: ${garment.name}; ${garment.type}; ${garment.color || "color uncertain"}; ${garment.material || "material uncertain"}. Technical extraction metrics: ${JSON.stringify(technical)}. The first images are evidence photos; the last image is the generated cutout. Penalize invented logos, text, seams, pockets, patterns, colors, materials, or silhouette. Similar style is not enough. Use review or fail when evidence is insufficient. Write issues and summary in Spanish.`,
  }];
  for (const reference of references.slice(0, 3)) {
    content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${arrayBufferToBase64(reference)}`, detail: "high" });
  }
  content.push({ type: "input_text", text: "FINAL GENERATED CUTOUT:" });
  content.push({ type: "input_image", image_url: `data:image/png;base64,${arrayBufferToBase64(cutout)}`, detail: "high" });
  const model = mode === "final" ? "gpt-5.6-terra" : "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: "system", content: [{ type: "input_text", text: "You are the strict visual and evidence QA gate for Vesta wardrobe reconstructions. Approve only faithful, useful assets." }] },
        { role: "user", content },
      ],
      text: { format: { type: "json_schema", name: "vesta_reconstruction_qa", strict: true, schema: qaSchema } },
    }),
  });
  const payload = await response.json() as OpenAIResponse;
  if (!response.ok) throw new ReconstructionError("qa_request_failed", payload.error?.message || `OpenAI returned ${response.status}.`);
  const output = extractOutputText(payload);
  if (!output) throw new ReconstructionError("qa_empty_output", "The QA model returned no result.");
  return JSON.parse(output) as VisualQa;
}

type Chroma = { name: string; rgb: [number, number, number] };

function chromaFor(color: string): Chroma {
  const normalized = color.toLowerCase();
  if (/verde|green|oliva|olive|lima|lime/u.test(normalized)) return { name: "electric magenta", rgb: [255, 0, 255] };
  if (/magenta|fucsia|pink|rosa|morado|purple|violet/u.test(normalized)) return { name: "electric cyan", rgb: [0, 255, 255] };
  return { name: "electric green", rgb: [0, 255, 0] };
}

export class ReconstructionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
