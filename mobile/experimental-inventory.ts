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
    is_basic: boolean;
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

export type ExperimentalTryOnGarment = {
  name: string;
  type: string;
  color: string;
  description?: string;
  placement: "head" | "upper_body" | "outer_layer" | "lower_body" | "feet" | "accessory";
  imageBase64: string;
};

export async function prepareAvatarTryOnReference(uri: string) {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { height: 1024 } }], {
    base64: true,
    compress: 0.82,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  if (!result.base64) throw new Error("avatar_image_conversion_failed");
  return result.base64;
}

export async function prepareTryOnGarmentReference(uri: string) {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1024 } }], {
    base64: true,
    compress: 0.82,
    format: ImageManipulator.SaveFormat.PNG,
  });
  if (!result.base64) throw new Error("product_image_conversion_failed");
  return result.base64;
}

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

const instructions = `You are the evidence-bound inventory stage of Vesta, a private personal wardrobe app.
Optimize for precision, not recall: a missed item is better than a false item. Identify only distinct physical garments whose own silhouette and garment body are clearly visible and reconstruction-ready. Return only candidates with visibility=clear and confidence at least 85; omit every uncertain, partial, held, tiny, or heavily occluded item instead of returning it.
Treat a zipped or closed outer layer as one garment. Never infer a shirt, logo garment, or other layer underneath from a small opening, collar fragment, logo, color patch, or fabric fragment. A logo visible on an outer garment belongs to that outer garment unless a separate underlying garment body and silhouette are independently visible. Never infer a bag from a strap alone; an accessory requires the actual accessory body to be clearly visible. Omit people, phones, furniture, luggage, and background objects.
Group repeated views of the same physical item within this request into one candidate with multiple evidence entries. Do not invent hidden details, brands, logos, materials, colors, or garment structure.
Set is_basic=true only for a plain, solid-color T-shirt, tank, or simple long-sleeve top with no visible logo, print, pattern, special trim, unusual cut, or other identity-bearing detail. Basic items remain inventory records but must not trigger catalog-image generation.
Bounding boxes use integer coordinates from 0 to 1000 relative to each full image. Each box must tightly cover the visible garment body and its visible silhouette. Confidence is evidence quality, not aesthetic quality. Write short Spanish names and descriptions.`;

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
  const evidence = garment.evidence.find((item) => item.photo_id === photo.id) ?? garment.evidence[0];
  const image = await prepareGarmentEvidence(photo.asset, evidence?.bbox);
  const chroma = chromaForGarment(garment.color);
  const prompt = `Create a clean ecommerce catalog image of only the target garment visibly supported by the reference: ${garment.name}; type: ${garment.type}; color: ${garment.color || "unknown"}. Remove the person, body, face, hands, phone, room, original background, interface, and every other object. Reconstruct only this physical garment faithfully, front view, centered, no mannequin, no body, and no hanger. BACKGROUND: perfectly flat uniform ${chroma.name} chroma background, exact RGB ${chroma.rgb.join(",")}, edge to edge, with no shadow, gradient, texture, floor, or backdrop seam. Keep that background color completely separate from the garment. Preserve garment-attached logos, graphics, text, patterns, seams, pockets, and branding only when they are clearly visible on the target garment; never invent, move, replace, or alter them. Preserve only details visibly supported by the reference.`;
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

export async function generateExperimentalTryOnImage(
  avatarBase64: string,
  garments: ExperimentalTryOnGarment[],
  quality: "low" | "medium" = "low",
) {
  if (!garments.length) throw new Error("try_on_garments_missing");
  const garmentList = garments.map((garment, index) => (
    `Image ${index + 2}: ${garment.name}; placement=${garment.placement}; type=${garment.type}; color=${garment.color}; details=${garment.description || "preserve only visible details"}.`
  )).join("\n");
  const prompt = `Use case: identity-preserve virtual try-on.
Image 1 is the exact base avatar and must remain the same person. Images 2 onward are garment references from the private wardrobe or a public retailer product page. A retailer reference may include a plain catalog background or a model; use only the specifically described product and ignore every other garment, person, prop, text, and background in that reference.
${garmentList}

Create one photorealistic full-body fashion fitting image in which the person from Image 1 is actually wearing every referenced garment in its specified anatomical placement. This must be a genuine image edit, not a collage or overlay: make fabric wrap around the body, follow the shoulders, chest, waist, hips, legs, head, or feet as appropriate, with realistic drape, folds, seams, sleeve openings, occlusion, scale, perspective, and contact shadows. Replace the neutral base clothing only where a selected garment belongs; keep neutral base clothing in unselected body regions.

Preserve the person's identity, face, hair, skin tone, body shape and proportions, standing pose, hands, feet, camera angle, framing, lighting, and warm solid background from Image 1. Preserve each garment's real color, silhouette, material cues, graphics, logos, patterns, trim, pockets, and construction exactly as supported by its reference image. Do not invent or alter branding. Do not show any floating garment, catalog cutout, duplicated clothing, mannequin, hanger, phone, text, extra person, extra limb, or extra object. Output only the finished full-body portrait.`;
  const requestedSize = quality === "low" ? "768x1024" : "1024x1536";
  const generationStartedAt = Date.now();
  const response = await codexImageEdit({
    images: [
      { image_url: `data:image/jpeg;base64,${avatarBase64}` },
      ...garments.map((garment) => ({ image_url: `data:image/png;base64,${garment.imageBase64}` })),
    ],
    prompt,
    background: "opaque",
    moderation: "low",
    model: "gpt-image-2",
    quality,
    size: requestedSize,
  });
  const payload = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string; code?: string } };
  if (!response.ok) throw new Error(payload.error?.code || payload.error?.message || `try_on_image_edit_${response.status}`);
  const result = payload.data?.[0]?.b64_json;
  if (!result) throw new Error("try_on_image_edit_empty");
  return {
    imageBase64: result,
    metrics: {
      requestedSize,
      generationRoundTripMs: Date.now() - generationStartedAt,
      avatarInputBytes: decodedBase64Bytes(avatarBase64),
      garmentInputBytes: garments.reduce((total, garment) => total + decodedBase64Bytes(garment.imageBase64), 0),
      outputBytes: decodedBase64Bytes(result),
    },
  };
}

export async function generateExperimentalAvatarImage(
  selfie: ImagePicker.ImagePickerAsset,
  fullBody: ImagePicker.ImagePickerAsset,
) {
  const [selfieBase64, bodyBase64] = await Promise.all([
    prepareImage(selfie),
    prepareImage(fullBody),
  ]);
  const prompt = `Create a canonical photorealistic full-body fitting avatar of the same person shown in both reference images.
Image 1 is the primary facial identity reference. Image 2 is the primary body-shape, height-proportion, limb-proportion, and posture reference.

Preserve the person's recognizable identity, facial geometry, hair, skin tone, body shape, natural proportions, and visible physical characteristics. Do not beautify, slim, enlarge muscles, change age, change ethnicity, or stylize the person. Create a neutral front-facing standing pose with the head level, arms relaxed and slightly separated from the torso, hands visible, legs naturally separated, and both feet fully visible.

Dress the person in unbranded neutral fitting clothes intended to be replaced later: a plain fitted charcoal short-sleeve T-shirt, straight black pants, and simple neutral shoes. Use a perfectly clean warm off-white studio background with soft even lighting. Remove phones, mirrors, furniture, bathroom details, text, logos, jewelry, bags, hats, and unrelated objects. Output one centered vertical full-body portrait only. This is a reusable identity-preserving base for virtual try-on, not a fashion look.`;
  const response = await codexImageEdit({
    images: [
      { image_url: `data:image/jpeg;base64,${selfieBase64}` },
      { image_url: `data:image/jpeg;base64,${bodyBase64}` },
    ],
    prompt,
    background: "opaque",
    moderation: "low",
    model: "gpt-image-2",
    quality: "medium",
    size: "1024x1536",
  });
  const payload = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string; code?: string } };
  if (!response.ok) throw new Error(payload.error?.code || payload.error?.message || `avatar_image_edit_${response.status}`);
  const result = payload.data?.[0]?.b64_json;
  if (!result) throw new Error("avatar_image_edit_empty");
  return result;
}

function chromaForGarment(color: string) {
  const normalized = color.toLowerCase();
  if (/verde|green|oliva|olive|lima|lime/u.test(normalized)) {
    return { name: "electric magenta", rgb: [255, 0, 255] as const };
  }
  if (/magenta|fucsia|pink|rosa|morado|purple|violet/u.test(normalized)) {
    return { name: "electric cyan", rgb: [0, 255, 255] as const };
  }
  return { name: "electric green", rgb: [0, 255, 0] as const };
}

async function prepareGarmentEvidence(
  photo: ImagePicker.ImagePickerAsset,
  bbox?: { x: number; y: number; width: number; height: number },
) {
  if (!bbox || !photo.width || !photo.height) return prepareImage(photo);
  const padding = 0.08;
  const left = Math.max(0, (bbox.x / 1000) - (bbox.width / 1000) * padding);
  const top = Math.max(0, (bbox.y / 1000) - (bbox.height / 1000) * padding);
  const right = Math.min(1, ((bbox.x + bbox.width) / 1000) + (bbox.width / 1000) * padding);
  const bottom = Math.min(1, ((bbox.y + bbox.height) / 1000) + (bbox.height / 1000) * padding);
  const originX = Math.max(0, Math.floor(left * photo.width));
  const originY = Math.max(0, Math.floor(top * photo.height));
  const width = Math.max(1, Math.min(photo.width - originX, Math.ceil((right - left) * photo.width)));
  const height = Math.max(1, Math.min(photo.height - originY, Math.ceil((bottom - top) * photo.height)));
  const maximumDimension = 1600;
  const actions: ImageManipulator.Action[] = [{ crop: { originX, originY, width, height } }];
  if (width > maximumDimension || height > maximumDimension) {
    actions.push(width >= height ? { resize: { width: maximumDimension } } : { resize: { height: maximumDimension } });
  }
  const result = await ImageManipulator.manipulateAsync(photo.uri, actions, {
    base64: true,
    compress: 0.88,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  if (!result.base64) throw new Error("photo_conversion_failed");
  return result.base64;
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

function decodedBase64Bytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
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
