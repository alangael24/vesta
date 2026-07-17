import { decode, encode } from "fast-png";
import { removeLightBackground } from "@/lib/light-background";

export function normalizeAvatarBackground(input: Uint8Array, contentType = "image/png") {
  const removed = removeLightBackground(input, contentType);
  if (!removed?.applied) return { png: input, applied: false };

  const image = decode(removed.png, { checkCrc: true });
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const source = pixel * image.channels;
    const destination = pixel * 4;
    const alpha = image.channels === 4 ? Number(image.data[source + 3]) / 255 : 1;
    rgba[destination] = compositeOnWhite(Number(image.data[source]), alpha);
    rgba[destination + 1] = compositeOnWhite(Number(image.data[source + 1]), alpha);
    rgba[destination + 2] = compositeOnWhite(Number(image.data[source + 2]), alpha);
    rgba[destination + 3] = 255;
  }
  return {
    png: encode({ width: image.width, height: image.height, data: rgba, channels: 4, depth: 8 }),
    applied: true,
  };
}

function compositeOnWhite(channel: number, alpha: number) {
  return Math.round(channel * alpha + 255 * (1 - alpha));
}
