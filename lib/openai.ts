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

