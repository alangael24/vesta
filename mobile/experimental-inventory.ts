import * as ImageManipulator from "expo-image-manipulator";
import type * as ImagePicker from "expo-image-picker";
import { codexFetch, codexImageEdit } from "./codex-auth";

export const EXPERIMENTAL_CODEX_MODEL = "gpt-5.6-luna";

export type ExperimentalPhoto = {
  id: string;
  asset: ImagePicker.ImagePickerAsset;
};

export type ExperimentalInventoryResult = {
  garments: Array<{
    candidate_key: string;
    name: string;
    category: "tops" | "layers" | "bottoms" | "footwear" | "accessories" | "one_piece" | "unknown";
    type: string;
    color: string;
    material: string;
    description: string;
    confidence: number;
    visibility: "clear" | "partial" | "held";
    evidence: Array<{
      photo_id: string;
      bbox: { x: number; y: number; width: number; height: number };
    }>;
  }>;
};

export type ExperimentalUsage = {
  photoCount: number;
  requestCount: number;
  elapsedMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  rateLimit?: {
    primaryUsedPercent?: number;
    primaryWindowMinutes?: number;
    primaryResetAt?: number;
    secondaryUsedPercent?: number;
    secondaryWindowMinutes?: number;
    secondaryResetAt?: number;
    creditBalance?: string;
    creditsUnlimited?: boolean;
  };
};

export type ExperimentalInventoryAnalysis = {
  results: ExperimentalInventoryResult[];
  usage: ExperimentalUsage;
};

export type ExperimentalGarmentCandidate = ExperimentalInventoryResult["garments"][number];

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
          category: { type: "string", enum: ["tops", "layers", "bottoms", "footwear", "accessories", "one_piece", "unknown"] },
          type: { type: "string" },
          color: { type: "string" },
          material: { type: "string" },
          description: { type: "string" },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
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
        required: ["candidate_key", "name", "category", "type", "color", "material", "description", "confidence", "visibility", "evidence"],
      },
    },
  },
  required: ["garments"],
} as const;

const instructions = `You are the evidence-bound inventory stage of Vesta, a private personal wardrobe app.
Identify only distinct wearable items visibly supported by the supplied photos. Group repeated views of the same physical item within this request into one candidate with multiple evidence entries. Do not invent hidden details, brands, logos, materials, colors, or garment structure. Omit people, furniture, luggage, and background objects. Accessories and footwear count when clearly visible.
Bounding boxes use integer coordinates from 0 to 1000 relative to each full image. Each box must tightly cover the visible garment. Use visibility=held when an item is too occluded, folded, tiny, or uncertain to reconstruct faithfully. Confidence is evidence quality, not aesthetic quality. Write short Spanish names and descriptions.`;

export async function analyzeExperimentalInventory(
  photos: ExperimentalPhoto[],
  onProgress?: (completed: number, total: number) => void,
) {
  const startedAt = Date.now();
  const chunks = chunk(photos, 4);
  const results: ExperimentalInventoryResult[] = [];
  const usage: ExperimentalUsage = {
    photoCount: photos.length,
    requestCount: chunks.length,
    elapsedMs: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const photoChunk = chunks[chunkIndex];
    const content: Array<Record<string, unknown>> = [{
      type: "input_text",
      text: `Photo IDs in the same order as the images: ${photoChunk.map((photo) => photo.id).join(", ")}. Return one evidence-bound wardrobe inventory for these images.`,
    }];
    for (const photo of photoChunk) {
      const image = await prepareImage(photo.asset);
      content.push({ type: "input_text", text: `Photo ID: ${photo.id}` });
      content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${image}`, detail: "high" });
    }

    const response = await codexFetch({
      model: EXPERIMENTAL_CODEX_MODEL,
      instructions,
      input: [{ role: "user", content }],
      tools: [],
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { effort: "low", summary: "auto" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      text: { format: { type: "json_schema", name: "vesta_inventory", strict: true, schema: inventorySchema } },
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(apiError(raw, response.status));
    const parsed = extractStream(raw);
    const outputText = parsed.outputText;
    if (!outputText) throw new Error("codex_empty_output");
    results.push(JSON.parse(stripCodeFence(outputText)) as ExperimentalInventoryResult);
    usage.inputTokens += parsed.usage.inputTokens;
    usage.cachedInputTokens += parsed.usage.cachedInputTokens;
    usage.outputTokens += parsed.usage.outputTokens;
    usage.reasoningOutputTokens += parsed.usage.reasoningOutputTokens;
    usage.totalTokens += parsed.usage.totalTokens;
    usage.rateLimit = parsed.rateLimit ?? readRateLimitHeaders(response) ?? usage.rateLimit;
    onProgress?.(chunkIndex + 1, chunks.length);
  }
  usage.elapsedMs = Date.now() - startedAt;
  return { results, usage } satisfies ExperimentalInventoryAnalysis;
}

export async function generateExperimentalGarmentImage(
  photo: ExperimentalPhoto,
  garment: ExperimentalGarmentCandidate,
) {
  const image = await prepareImage(photo.asset);
  const prompt = `Create a clean ecommerce catalog image of only the target garment visibly supported by the reference: ${garment.name}; type: ${garment.type}; color: ${garment.color || "unknown"}. Remove the person, body, face, hands, phone, room, background, text, interface, and every other object. Reconstruct only this physical garment faithfully, front view, centered, white background, no mannequin, no body, no hanger, no logo, no invented graphics, patterns, seams, pockets, or branding. Preserve only details visibly supported by the reference.`;
  const response = await codexImageEdit({
    images: [{ image_url: `data:image/jpeg;base64,${image}` }],
    prompt,
    background: "opaque",
    model: "gpt-image-2",
    quality: "auto",
    size: "auto",
  });
  const payload = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `image_edit_${response.status}`);
  const result = payload.data?.[0]?.b64_json;
  if (!result) throw new Error("image_edit_empty");
  return result;
}

async function prepareImage(photo: ImagePicker.ImagePickerAsset) {
  const maximumDimension = 1600;
  const actions: ImageManipulator.Action[] = [];
  if (photo.width > maximumDimension || photo.height > maximumDimension) {
    actions.push(photo.width >= photo.height
      ? { resize: { width: maximumDimension } }
      : { resize: { height: maximumDimension } });
  }
  const result = await ImageManipulator.manipulateAsync(photo.uri, actions, {
    base64: true,
    compress: 0.82,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  if (!result.base64) throw new Error("photo_conversion_failed");
  return result.base64;
}

function extractStream(raw: string) {
  let output = "";
  let usage = emptyTokenUsage();
  let rateLimit: ExperimentalUsage["rateLimit"];
  for (const line of raw.split(/\r?\n/gu)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data) as Record<string, unknown>;
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") output += event.delta;
      if (!output && event.type === "response.output_text.done" && typeof event.text === "string") output = event.text;
      if (event.type === "response.completed" && event.response) {
        if (!output) output = extractOutputText(event.response);
        usage = extractUsage(event.response);
      }
      if (event.type === "codex.rate_limits") rateLimit = extractRateLimitEvent(event);
      if (event.type === "error") throw new Error("codex_stream_error");
    } catch (error) {
      if (error instanceof Error && error.message === "codex_stream_error") throw error;
    }
  }
  if (output) return { outputText: output, usage, rateLimit };
  try {
    const response = JSON.parse(raw) as unknown;
    return { outputText: extractOutputText(response), usage: extractUsage(response), rateLimit };
  } catch {
    return { outputText: "", usage, rateLimit };
  }
}

function emptyTokenUsage() {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
}

function extractUsage(value: unknown) {
  if (!value || typeof value !== "object") return emptyTokenUsage();
  const raw = (value as { usage?: unknown }).usage;
  if (!raw || typeof raw !== "object") return emptyTokenUsage();
  const item = raw as Record<string, unknown>;
  const inputDetails = item.input_tokens_details as Record<string, unknown> | undefined;
  const outputDetails = item.output_tokens_details as Record<string, unknown> | undefined;
  return {
    inputTokens: safeCount(item.input_tokens),
    cachedInputTokens: safeCount(inputDetails?.cached_tokens),
    outputTokens: safeCount(item.output_tokens),
    reasoningOutputTokens: safeCount(outputDetails?.reasoning_tokens),
    totalTokens: safeCount(item.total_tokens),
  };
}

function extractRateLimitEvent(event: Record<string, unknown>): ExperimentalUsage["rateLimit"] {
  const limits = event.rate_limits as Record<string, unknown> | undefined;
  const primary = limits?.primary as Record<string, unknown> | undefined;
  const secondary = limits?.secondary as Record<string, unknown> | undefined;
  const credits = event.credits as Record<string, unknown> | undefined;
  return cleanRateLimit({
    primaryUsedPercent: safeFinite(primary?.used_percent),
    primaryWindowMinutes: safeFinite(primary?.window_minutes),
    primaryResetAt: safeFinite(primary?.reset_at),
    secondaryUsedPercent: safeFinite(secondary?.used_percent),
    secondaryWindowMinutes: safeFinite(secondary?.window_minutes),
    secondaryResetAt: safeFinite(secondary?.reset_at),
    creditBalance: typeof credits?.balance === "string" ? credits.balance : undefined,
    creditsUnlimited: typeof credits?.unlimited === "boolean" ? credits.unlimited : undefined,
  });
}

function readRateLimitHeaders(response: Response): ExperimentalUsage["rateLimit"] {
  return cleanRateLimit({
    primaryUsedPercent: headerNumber(response, "x-codex-primary-used-percent"),
    primaryWindowMinutes: headerNumber(response, "x-codex-primary-window-minutes"),
    primaryResetAt: headerNumber(response, "x-codex-primary-reset-at"),
    secondaryUsedPercent: headerNumber(response, "x-codex-secondary-used-percent"),
    secondaryWindowMinutes: headerNumber(response, "x-codex-secondary-window-minutes"),
    secondaryResetAt: headerNumber(response, "x-codex-secondary-reset-at"),
    creditBalance: response.headers.get("x-codex-credits-balance") ?? undefined,
    creditsUnlimited: headerBoolean(response, "x-codex-credits-unlimited"),
  });
}

function cleanRateLimit(value: NonNullable<ExperimentalUsage["rateLimit"]>) {
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

function safeCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function headerNumber(response: Response, name: string) {
  const value = response.headers.get(name);
  if (value === null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function headerBoolean(response: Response, name: string) {
  const value = response.headers.get(name)?.toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function extractOutputText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const response = value as { output_text?: unknown; output?: unknown };
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return "";
  for (const item of response.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function apiError(raw: string, status: number) {
  try {
    const payload = JSON.parse(raw) as { error?: { message?: string }; detail?: string };
    return payload.error?.message || payload.detail || `codex_request_${status}`;
  } catch {
    return `codex_request_${status}`;
  }
}

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
}

function chunk<T>(values: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}
