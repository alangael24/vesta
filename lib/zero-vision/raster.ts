import { decode as decodeJpeg } from "jpeg-js";
import { decode as decodePng, encode as encodePng } from "fast-png";
import type { RgbaImage } from "./core";
import { ZeroVisionError } from "./core";

const maximumPixels = 8_000_000;

export function decodeRaster(input: Uint8Array, contentType = "application/octet-stream"): RgbaImage {
  const type = contentType.split(";", 1)[0].trim().toLowerCase();
  if (type === "image/jpeg" || isJpeg(input)) {
    const image = decodeJpeg(input, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: true,
      maxResolutionInMP: 24,
      maxMemoryUsageInMB: 192,
    });
    validateDimensions(image.width, image.height);
    return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  }
  if (type !== "image/png" && !isPng(input)) throw new ZeroVisionError("image_type_unsupported", "Only PNG and JPEG images are supported.");
  validatePngHeader(input);
  const image = decodePng(input, { checkCrc: true });
  validateDimensions(image.width, image.height);
  const data = new Uint8Array(image.width * image.height * 4);
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const source = pixel * image.channels;
    const destination = pixel * 4;
    if (image.channels === 1 || image.channels === 2) {
      const value = Number(image.data[source]);
      data[destination] = value;
      data[destination + 1] = value;
      data[destination + 2] = value;
      data[destination + 3] = image.channels === 2 ? Number(image.data[source + 1]) : 255;
    } else {
      data[destination] = Number(image.data[source]);
      data[destination + 1] = Number(image.data[source + 1]);
      data[destination + 2] = Number(image.data[source + 2]);
      data[destination + 3] = image.channels === 4 ? Number(image.data[source + 3]) : 255;
    }
  }
  return { width: image.width, height: image.height, data };
}

export function encodeRasterPng(image: RgbaImage) {
  validateDimensions(image.width, image.height);
  if (image.data.length !== image.width * image.height * 4) throw new ZeroVisionError("image_data_invalid", "RGBA data length is invalid.");
  return encodePng({ width: image.width, height: image.height, data: image.data, channels: 4, depth: 8 });
}

function validatePngHeader(input: Uint8Array) {
  if (input.length < 24 || !isPng(input)) throw new ZeroVisionError("invalid_png", "The PNG header is invalid.");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  validateDimensions(view.getUint32(16), view.getUint32(20));
}

function validateDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > maximumPixels) {
    throw new ZeroVisionError("image_dimensions_unsupported", "Image dimensions are unsupported.");
  }
}

function isPng(input: Uint8Array) {
  return input.length >= 8 && input[0] === 0x89 && input[1] === 0x50 && input[2] === 0x4e && input[3] === 0x47;
}

function isJpeg(input: Uint8Array) {
  return input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
}
