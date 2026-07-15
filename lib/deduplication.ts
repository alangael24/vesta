import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { garments } from "@/db/schema";
import { InventoryError, ProcessingMode } from "@/lib/inventory";
import { arrayBufferToBase64, extractOutputText, getOpenAIKey, OpenAIResponse } from "@/lib/openai";
import { getMediaBucket } from "@/lib/storage";

type Garment = typeof garments.$inferSelect;

type DedupResult = {
  pairs: Array<{
    keep_id: string;
    duplicate_id: string;
    confidence: number;
    rationale: string;
  }>;
};

const dedupSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          keep_id: { type: "string" },
          duplicate_id: { type: "string" },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          rationale: { type: "string" },
        },
        required: ["keep_id", "duplicate_id", "confidence", "rationale"],
      },
    },
  },
  required: ["pairs"],
} as const;

const prompt = `You are Vesta's conservative duplicate reviewer. Each supplied image is an evidence preview of a candidate garment.
Only call two candidates duplicates when they are the same physical item photographed more than once and visible details support that conclusion. Two similar or identical-looking products are not enough. Plain garments without distinguishing evidence must remain separate. Never merge different sizes, cuts, fabrics, wear marks, seams, buttons, prints, washes, or color shades. Return no pair when uncertain. Choose the clearer candidate as keep_id. Write a short Spanish rationale.`;

export async function runDeduplication(ownerId: string, batchId: string, mode: ProcessingMode) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new InventoryError("processing_not_configured", "OpenAI processing is not configured.");
  const candidates = await getDb().select().from(garments).where(and(
    eq(garments.ownerId, ownerId),
    eq(garments.batchId, batchId),
    inArray(garments.status, ["candidate", "held"]),
  ));
  const groups = fingerprintGroups(candidates);
  const model = mode === "quality" ? "gpt-5.6" : "gpt-5.6-luna";
  let inputTokens = 0;
  let outputTokens = 0;
  let duplicateCount = 0;
  const decided = new Set<string>();

  for (const group of groups) {
    for (const comparison of comparisonChunks(group, 8)) {
      const content: Array<Record<string, unknown>> = [{
        type: "input_text",
        text: `Candidates: ${comparison.map(describe).join("\n")}`,
      }];
      for (const candidate of comparison) {
        if (!candidate.previewKey) continue;
        const object = await getMediaBucket().get(candidate.previewKey);
        if (!object) continue;
        content.push({ type: "input_text", text: `Candidate ID: ${candidate.id}` });
        content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${arrayBufferToBase64(await object.arrayBuffer())}`, detail: "high" });
      }
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          store: false,
          input: [
            { role: "system", content: [{ type: "input_text", text: prompt }] },
            { role: "user", content },
          ],
          text: { format: { type: "json_schema", name: "vesta_deduplication", strict: true, schema: dedupSchema } },
        }),
      });
      const payload = await response.json() as OpenAIResponse;
      if (!response.ok) throw new InventoryError("deduplication_request_failed", payload.error?.message || `OpenAI returned ${response.status}.`);
      const outputText = extractOutputText(payload);
      if (!outputText) throw new InventoryError("deduplication_empty_output", "OpenAI returned no duplicate review.");
      const result = JSON.parse(outputText) as DedupResult;
      inputTokens += payload.usage?.input_tokens ?? 0;
      outputTokens += payload.usage?.output_tokens ?? 0;
      const validIds = new Set(comparison.map((item) => item.id));
      for (const pair of result.pairs) {
        if (pair.confidence < 95 || pair.keep_id === pair.duplicate_id) continue;
        if (!validIds.has(pair.keep_id) || !validIds.has(pair.duplicate_id)) continue;
        if (decided.has(pair.keep_id) || decided.has(pair.duplicate_id)) continue;
        await getDb().update(garments).set({
          status: "duplicate",
          duplicateOfId: pair.keep_id,
          dedupConfidence: Math.min(100, Math.max(0, Math.round(pair.confidence))),
          dedupRationale: pair.rationale.slice(0, 500),
          updatedAt: new Date().toISOString(),
        }).where(and(eq(garments.id, pair.duplicate_id), eq(garments.ownerId, ownerId)));
        decided.add(pair.duplicate_id);
        duplicateCount += 1;
      }
    }
  }
  return { duplicateCount, inputTokens, outputTokens, model, reviewedGroups: groups.length };
}

function fingerprintGroups(candidates: Garment[]) {
  const grouped = new Map<string, Garment[]>();
  for (const candidate of candidates) {
    if (!candidate.fingerprint || !candidate.previewKey) continue;
    const current = grouped.get(candidate.fingerprint) ?? [];
    current.push(candidate);
    grouped.set(candidate.fingerprint, current);
  }
  return Array.from(grouped.values()).filter((group) => group.length > 1);
}

function comparisonChunks(group: Garment[], size: number) {
  if (group.length <= size) return [group];
  const chunks: Garment[][] = [];
  for (let index = 1; index < group.length; index += size - 1) chunks.push([group[0], ...group.slice(index, index + size - 1)]);
  return chunks;
}

function describe(item: Garment) {
  return `${item.id}: ${item.name}; ${item.type}; ${item.color || "color incierto"}; ${item.material || "material incierto"}; confianza ${item.confidence ?? 0}`;
}
