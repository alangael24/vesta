import { env } from "cloudflare:workers";

type ImagesBinding = {
  input(stream: ReadableStream): {
    transform(options: Record<string, unknown>): {
      output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
    };
  };
};

export function getOpenAIKey() {
  return (env as unknown as { OPENAI_API_KEY?: string }).OPENAI_API_KEY?.trim() || null;
}

export function getImagesBinding(): ImagesBinding {
  const binding = (env as unknown as { IMAGES?: ImagesBinding }).IMAGES;
  if (!binding) throw new Error("Cloudflare Images binding `IMAGES` is unavailable.");
  return binding;
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export type OpenAIResponse = {
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; code?: string };
};

export function extractOutputText(payload: OpenAIResponse) {
  for (const output of payload.output ?? []) {
    if (output.type !== "message") continue;
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.type === "refusal") throw new Error(content.refusal || "The request was refused.");
    }
  }
  return null;
}
