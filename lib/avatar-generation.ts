import { base64ToBytes, getOpenAIKey } from "@/lib/openai";

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string; code?: string };
};

export async function generateCanonicalAvatar(selfie: File, fullBody: File) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new AvatarGenerationError("processing_not_configured", "OpenAI processing is not configured.");

  const form = new FormData();
  form.set("model", "gpt-image-2");
  form.set("prompt", avatarPrompt);
  form.set("quality", "medium");
  form.set("size", "1024x1536");
  form.set("output_format", "png");
  form.set("background", "opaque");
  form.set("moderation", "low");
  form.append("image[]", selfie, "selfie.jpg");
  form.append("image[]", fullBody, "full-body.jpg");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await response.json() as ImageResponse;
  if (!response.ok) {
    throw new AvatarGenerationError(payload.error?.code || "avatar_request_failed", payload.error?.message || `OpenAI returned ${response.status}.`);
  }
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw new AvatarGenerationError("avatar_empty_output", "The image model returned no image.");
  return base64ToBytes(encoded);
}

const avatarPrompt = `Create a canonical photorealistic full-body fitting avatar of the same person shown in both reference images.
Image 1 is the primary facial identity reference. Image 2 is the primary body-shape, height-proportion, limb-proportion, and posture reference.

Preserve the person's recognizable identity, facial geometry, hair, skin tone, body shape, natural proportions, and visible physical characteristics. Do not beautify, slim, enlarge muscles, change age, change ethnicity, or stylize the person. Create a neutral front-facing standing pose with the head level, arms relaxed and slightly separated from the torso, hands visible, legs naturally separated, and both feet fully visible.

Dress the person in unbranded neutral fitting clothes intended to be replaced later: a plain fitted charcoal short-sleeve T-shirt, straight black pants, and simple neutral shoes. Use a perfectly clean warm off-white studio background with soft even lighting. Remove phones, mirrors, furniture, bathroom details, text, logos, jewelry, bags, hats, and unrelated objects. Output one centered vertical full-body portrait only. This is a reusable identity-preserving base for virtual try-on, not a fashion look.`;

export class AvatarGenerationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
