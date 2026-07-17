export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type NormalizedPoint = { x: number; y: number };
export type NormalizedRect = { x: number; y: number; width: number; height: number };

export type SegmentationMode = "plain" | "rectangle";

export type SegmentationOptions = {
  mode: SegmentationMode;
  rect?: NormalizedRect;
  foregroundPoints?: NormalizedPoint[];
  backgroundPoints?: NormalizedPoint[];
  maxWorkingSide?: number;
};

export type SegmentationMetrics = {
  mode: SegmentationMode;
  score: number;
  width: number;
  height: number;
  foregroundPixelRatio: number;
  transparentPixelRatio: number;
  edgeContactRatio: number;
  largestComponentRatio: number;
  backgroundCoverageRatio: number;
  backgroundColor: [number, number, number] | null;
  backgroundTolerance: number | null;
  reasons: string[];
};

export type SegmentationResult = {
  mask: Uint8Array;
  metrics: SegmentationMetrics;
};

export type CanonicalAvatarResult = {
  image: RgbaImage;
  mask: Uint8Array;
  score: number;
  accepted: boolean;
  reasons: string[];
  sourceBounds: PixelBounds | null;
};

export type PixelBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const DEFAULT_WORKING_SIDE = 176;
const MAX_PIXELS = 8_000_000;

export function segmentForeground(image: RgbaImage, options: SegmentationOptions): SegmentationResult {
  validateImage(image);
  if (options.mode === "plain") return segmentPlainBackground(image);
  if (!options.rect) throw new ZeroVisionError("rectangle_required", "A garment rectangle is required.");
  return segmentRectangle(image, options.rect, options.foregroundPoints || [], options.backgroundPoints || [], options.maxWorkingSide || DEFAULT_WORKING_SIDE);
}

export function segmentPlainBackground(image: RgbaImage): SegmentationResult {
  validateImage(image);

  // Keep worker CPU bounded even when callers upload a multi-megapixel photo.
  // The mask is estimated at a stable working resolution and then refined on
  // the original pixels, so the final cutout keeps the source detail.
  const work = resizeForWorking(image, 640);
  const model = estimateEdgeBackground(work);
  if (!model) {
    return emptySegmentation(image, "plain", ["background_not_uniform"]);
  }

  const workPixels = work.width * work.height;
  const background = floodBackground(work, model.color, model.tolerance);
  const rawWorkMask = new Uint8Array(workPixels);
  let rawWorkForeground = 0;
  for (let pixel = 0; pixel < workPixels; pixel += 1) {
    const alpha = work.data[pixel * 4 + 3];
    const value = !background[pixel] && alpha >= 24 ? 1 : 0;
    rawWorkMask[pixel] = value;
    rawWorkForeground += value;
  }

  const backgroundCoverageRatio = ratio(background.reduce((sum, value) => sum + value, 0), workPixels);
  const cleanedWork = cleanupBinaryMask(rawWorkMask, work.width, work.height, true);
  const originalBinary = work.width === image.width && work.height === image.height
    ? cleanedWork.mask
    : upscaleBinaryMask(cleanedWork.mask, work.width, work.height, image.width, image.height);
  const softWorkMask = featherMask(cleanedWork.mask, work.width, work.height, 2);
  const mask = work.width === image.width && work.height === image.height
    ? softWorkMask
    : upscaleSoftMask(softWorkMask, work.width, work.height, image.width, image.height);
  const metrics = scoreSegmentation({
    mode: "plain",
    image,
    binaryMask: originalBinary,
    rawForegroundCount: Math.round(rawWorkForeground / workPixels * image.width * image.height),
    largestComponentRatio: cleanedWork.largestComponentRatio,
    backgroundCoverageRatio,
    backgroundColor: model.color,
    backgroundTolerance: model.tolerance,
  });
  return { mask, metrics };
}

export function segmentRectangle(
  image: RgbaImage,
  rect: NormalizedRect,
  foregroundPoints: NormalizedPoint[] = [],
  backgroundPoints: NormalizedPoint[] = [],
  maxWorkingSide = DEFAULT_WORKING_SIDE,
): SegmentationResult {
  validateImage(image);
  const safeRect = normalizeRect(rect);
  const work = resizeForWorking(image, clampInt(maxWorkingSide, 72, 192));
  const workRect = rectToPixels(safeRect, work.width, work.height);
  const labels = new Uint8Array(work.width * work.height);
  const hardForeground = new Uint8Array(labels.length);
  const hardBackground = new Uint8Array(labels.length);

  const insetX = Math.max(1, Math.floor(workRect.width * 0.18));
  const insetY = Math.max(1, Math.floor(workRect.height * 0.18));
  const core = {
    left: workRect.left + insetX,
    top: workRect.top + insetY,
    right: workRect.right - insetX,
    bottom: workRect.bottom - insetY,
  };

  for (let y = 0; y < work.height; y += 1) {
    for (let x = 0; x < work.width; x += 1) {
      const pixel = y * work.width + x;
      const inside = x >= workRect.left && x <= workRect.right && y >= workRect.top && y <= workRect.bottom;
      const insideCore = x >= core.left && x <= core.right && y >= core.top && y <= core.bottom;
      if (!inside) {
        hardBackground[pixel] = 1;
        labels[pixel] = 0;
      } else if (insideCore) {
        labels[pixel] = 1;
      }
    }
  }

  applyPointSeeds(foregroundPoints, work.width, work.height, labels, hardForeground, 1);
  applyPointSeeds(backgroundPoints, work.width, work.height, labels, hardBackground, 0);

  let foregroundModel = fitColorModel(work, seedIndices(labels, hardForeground, 1, workRect), 5);
  // Rectangle initialization must not learn the garment perimeter as background.
  // Only pixels known to be outside the user rectangle seed the first background model.
  let backgroundModel = fitColorModel(work, markedIndices(hardBackground), 5);
  if (!foregroundModel.length || !backgroundModel.length) {
    return emptySegmentation(image, "rectangle", ["color_models_unavailable"]);
  }

  const pairwiseScale = estimatePairwiseScale(work);
  const centerX = (workRect.left + workRect.right) / 2;
  const centerY = (workRect.top + workRect.bottom) / 2;
  const radiusX = Math.max(1, workRect.width / 2);
  const radiusY = Math.max(1, workRect.height / 2);
  let averageMargin = 0;

  for (let iteration = 0; iteration < 10; iteration += 1) {
    let changed = 0;
    let totalMargin = 0;
    let evaluated = 0;
    const reverse = iteration % 2 === 1;
    const yStart = reverse ? workRect.bottom : workRect.top;
    const yEnd = reverse ? workRect.top - 1 : workRect.bottom + 1;
    const yStep = reverse ? -1 : 1;
    const xStart = reverse ? workRect.right : workRect.left;
    const xEnd = reverse ? workRect.left - 1 : workRect.right + 1;
    const xStep = reverse ? -1 : 1;

    for (let y = yStart; y !== yEnd; y += yStep) {
      for (let x = xStart; x !== xEnd; x += xStep) {
        const pixel = y * work.width + x;
        if (hardForeground[pixel]) {
          labels[pixel] = 1;
          continue;
        }
        if (hardBackground[pixel]) {
          labels[pixel] = 0;
          continue;
        }
        const color = colorAt(work, pixel);
        const foregroundDistance = nearestColorDistance(color, foregroundModel);
        const backgroundDistance = nearestColorDistance(color, backgroundModel);
        const ellipse = Math.sqrt(((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2);
        const spatialForegroundPenalty = Math.max(0, ellipse - 0.78) * 1.15;
        const spatialBackgroundPenalty = Math.max(0, 0.38 - ellipse) * 0.8;
        const unaryForeground = Math.log1p(foregroundDistance / 520) + spatialForegroundPenalty;
        const unaryBackground = Math.log1p(backgroundDistance / 520) + spatialBackgroundPenalty;
        let smoothForeground = 0;
        let smoothBackground = 0;
        for (const neighbor of neighbors4(x, y, work.width, work.height)) {
          const neighborColor = colorAt(work, neighbor);
          const weight = 0.85 * Math.exp(-colorDistanceSquared(color, neighborColor) / pairwiseScale);
          if (labels[neighbor]) smoothBackground += weight;
          else smoothForeground += weight;
        }
        const foregroundEnergy = unaryForeground + smoothForeground;
        const backgroundEnergy = unaryBackground + smoothBackground;
        const next = foregroundEnergy <= backgroundEnergy ? 1 : 0;
        totalMargin += Math.abs(foregroundEnergy - backgroundEnergy);
        evaluated += 1;
        if (labels[pixel] !== next) {
          labels[pixel] = next;
          changed += 1;
        }
      }
    }
    averageMargin = evaluated ? totalMargin / evaluated : 0;
    if (iteration === 2 || iteration === 5 || iteration === 8) {
      foregroundModel = fitColorModel(work, labelIndices(labels, 1, workRect, work.width), 5);
      backgroundModel = fitColorModel(work, backgroundIndices(labels, workRect, work.width, work.height), 5);
    }
    if (changed < Math.max(3, workRect.width * workRect.height * 0.0008)) break;
  }

  const cleanedWork = cleanupBinaryMask(labels, work.width, work.height, true, workRect);
  const originalBinary = upscaleBinaryMask(cleanedWork.mask, work.width, work.height, image.width, image.height);
  const softWorkMask = featherMask(cleanedWork.mask, work.width, work.height, 2);
  const mask = upscaleSoftMask(softWorkMask, work.width, work.height, image.width, image.height);
  const backgroundCoverageRatio = ratio(countOutsideRect(image.width, image.height, rectToPixels(safeRect, image.width, image.height)), image.width * image.height);
  const metrics = scoreSegmentation({
    mode: "rectangle",
    image,
    binaryMask: originalBinary,
    rawForegroundCount: countOnes(originalBinary),
    largestComponentRatio: cleanedWork.largestComponentRatio,
    backgroundCoverageRatio,
    backgroundColor: null,
    backgroundTolerance: null,
    energyMargin: averageMargin,
  });
  return { mask, metrics };
}

export function createGarmentCutout(image: RgbaImage, segmentation: SegmentationResult, size = 1024): RgbaImage {
  const bounds = maskBounds(segmentation.mask, image.width, image.height, 16);
  if (!bounds) throw new ZeroVisionError("foreground_missing", "No foreground was found.");
  return renderMaskedToCanvas(image, segmentation.mask, size, size, {
    transparent: true,
    targetFill: 0.86,
    bounds,
  });
}

export function canonicalizeAvatarPhoto(image: RgbaImage, width = 1024, height = 1536): CanonicalAvatarResult {
  const segmentation = segmentPlainBackground(image);
  const bounds = maskBounds(segmentation.mask, image.width, image.height, 24);
  const reasons = [...segmentation.metrics.reasons];
  let score = segmentation.metrics.score;
  if (!bounds) {
    return {
      image: blankImage(width, height, [255, 255, 255, 255]),
      mask: segmentation.mask,
      score: 0,
      accepted: false,
      reasons: unique([...reasons, "person_not_separated"]),
      sourceBounds: null,
    };
  }

  const heightRatio = bounds.height / image.height;
  const widthRatio = bounds.width / image.width;
  const centerOffset = Math.abs((bounds.left + bounds.right) / 2 / image.width - 0.5);
  const topMargin = bounds.top / image.height;
  const bottomMargin = (image.height - 1 - bounds.bottom) / image.height;
  const topWidth = silhouetteWidth(segmentation.mask, image.width, image.height, bounds, 0.08, 0.18);
  const torsoWidth = silhouetteWidth(segmentation.mask, image.width, image.height, bounds, 0.28, 0.48);

  if (heightRatio < 0.62) {
    reasons.push("body_too_small");
    score -= 22;
  }
  if (heightRatio > 0.985 || topMargin < 0.006 || bottomMargin < 0.006) {
    reasons.push("body_clipped");
    score -= 30;
  }
  if (widthRatio < 0.12 || widthRatio > 0.86) {
    reasons.push("body_width_unusual");
    score -= 12;
  }
  if (centerOffset > 0.14) {
    reasons.push("body_not_centered");
    score -= Math.round(centerOffset * 70);
  }
  if (torsoWidth > 0 && topWidth / torsoWidth > 0.92) {
    reasons.push("head_or_shoulders_unclear");
    score -= 10;
  }
  if (segmentation.metrics.edgeContactRatio > 2.5) {
    reasons.push("foreground_touches_frame");
    score -= 16;
  }
  score = clampInt(score, 0, 100);

  const output = renderMaskedToCanvas(image, segmentation.mask, width, height, {
    transparent: false,
    targetFill: 0.90,
    bounds,
    topBias: 0.055,
  });
  return {
    image: output,
    mask: segmentation.mask,
    score,
    accepted: score >= 68 && !reasons.includes("body_clipped") && !reasons.includes("person_not_separated"),
    reasons: unique(reasons),
    sourceBounds: bounds,
  };
}

export function dominantColorName(image: RgbaImage, mask?: Uint8Array): { name: string; rgb: [number, number, number] } {
  validateImage(image);
  const samples: Array<[number, number, number]> = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((image.width * image.height) / 12_000)));
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const pixel = y * image.width + x;
      const alpha = mask ? mask[pixel] : image.data[pixel * 4 + 3];
      if (alpha < 160) continue;
      const color = colorAt(image, pixel);
      const luminance = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
      if (luminance > 248 || luminance < 5) continue;
      samples.push(color);
    }
  }
  if (!samples.length) return { name: "Sin confirmar", rgb: [128, 128, 128] };
  const centroids = kmeansColors(samples, Math.min(4, samples.length), 8);
  let best = centroids[0];
  let bestCount = -1;
  for (const centroid of centroids) {
    let count = 0;
    for (const sample of samples) if (nearestColorIndex(sample, centroids) === centroids.indexOf(centroid)) count += 1;
    const chroma = Math.max(...centroid) - Math.min(...centroid);
    const luminance = centroid[0] * 0.299 + centroid[1] * 0.587 + centroid[2] * 0.114;
    const salience = count * (luminance > 242 && chroma < 16 ? 0.35 : 1);
    if (salience > bestCount) {
      best = centroid;
      bestCount = salience;
    }
  }
  const rgb: [number, number, number] = [Math.round(best[0]), Math.round(best[1]), Math.round(best[2])];
  return { name: nearestNamedColor(rgb), rgb };
}

export function perceptualHash(image: RgbaImage, mask?: Uint8Array): string {
  validateImage(image);
  const bounds = mask ? maskBounds(mask, image.width, image.height, 8) : { left: 0, top: 0, right: image.width - 1, bottom: image.height - 1, width: image.width, height: image.height };
  if (!bounds) return "0000000000000000";
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < 9; x += 1) {
      const sourceX = bounds.left + (x / 8) * Math.max(1, bounds.width - 1);
      const sourceY = bounds.top + ((y + 0.5) / 8) * Math.max(1, bounds.height - 1);
      const [red, green, blue, alpha] = sampleBilinear(image, sourceX, sourceY, mask);
      const composited = alpha / 255;
      row.push((red * 0.299 + green * 0.587 + blue * 0.114) * composited + 255 * (1 - composited));
    }
    for (let x = 0; x < 8; x += 1) bits += row[x] > row[x + 1] ? "1" : "0";
  }
  let output = "";
  for (let offset = 0; offset < bits.length; offset += 4) output += Number.parseInt(bits.slice(offset, offset + 4), 2).toString(16);
  return output.padStart(16, "0");
}

export function hammingDistanceHex(first: string, second: string): number {
  if (first.length !== second.length) return Math.max(first.length, second.length) * 4;
  let distance = 0;
  for (let index = 0; index < first.length; index += 1) {
    let value = Number.parseInt(first[index], 16) ^ Number.parseInt(second[index], 16);
    while (value) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
}

export function maskBounds(mask: Uint8Array, width: number, height: number, threshold = 128): PixelBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] < threshold) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top ? null : { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

function emptySegmentation(image: RgbaImage, mode: SegmentationMode, reasons: string[]): SegmentationResult {
  return {
    mask: new Uint8Array(image.width * image.height),
    metrics: {
      mode,
      score: 0,
      width: image.width,
      height: image.height,
      foregroundPixelRatio: 0,
      transparentPixelRatio: 100,
      edgeContactRatio: 0,
      largestComponentRatio: 0,
      backgroundCoverageRatio: 0,
      backgroundColor: null,
      backgroundTolerance: null,
      reasons,
    },
  };
}

function estimateEdgeBackground(image: RgbaImage): { color: [number, number, number]; tolerance: number } | null {
  const samples: Array<[number, number, number]> = [];
  const push = (x: number, y: number) => {
    const pixel = y * image.width + x;
    if (image.data[pixel * 4 + 3] < 24) return;
    samples.push(colorAt(image, pixel));
  };
  const stepX = Math.max(1, Math.floor(image.width / 160));
  const stepY = Math.max(1, Math.floor(image.height / 160));
  for (let x = 0; x < image.width; x += stepX) {
    push(x, 0);
    push(x, image.height - 1);
  }
  for (let y = stepY; y < image.height - 1; y += stepY) {
    push(0, y);
    push(image.width - 1, y);
  }
  if (samples.length < 12) return null;
  const color: [number, number, number] = [median(samples.map((value) => value[0])), median(samples.map((value) => value[1])), median(samples.map((value) => value[2]))];
  const distances = samples.map((value) => Math.sqrt(colorDistanceSquared(value, color)));
  const medianDistance = median(distances);
  const deviation = median(distances.map((value) => Math.abs(value - medianDistance)));
  const inliers = distances.filter((value) => value <= medianDistance + Math.max(8, deviation * 3.2));
  if (inliers.length / samples.length < 0.58) return null;
  const tolerance = clamp(18 + medianDistance * 1.15 + deviation * 3.4, 20, 82);
  return { color, tolerance };
}

function floodBackground(image: RgbaImage, target: [number, number, number], tolerance: number): Uint8Array {
  const pixels = image.width * image.height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  const canVisit = (pixel: number) => {
    const alpha = image.data[pixel * 4 + 3];
    if (alpha < 24) return true;
    const color = colorAt(image, pixel);
    const luminanceDelta = Math.abs(luminance(color) - luminance(target));
    return colorDistanceSquared(color, target) <= tolerance * tolerance && luminanceDelta <= tolerance * 0.82;
  };
  const enqueue = (pixel: number) => {
    if (pixel < 0 || pixel >= pixels || visited[pixel] || !canVisit(pixel)) return;
    visited[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < image.width; x += 1) {
    enqueue(x);
    enqueue((image.height - 1) * image.width + x);
  }
  for (let y = 1; y < image.height - 1; y += 1) {
    enqueue(y * image.width);
    enqueue(y * image.width + image.width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < image.width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - image.width);
    if (y + 1 < image.height) enqueue(pixel + image.width);
  }
  return visited;
}

function cleanupBinaryMask(mask: Uint8Array, width: number, height: number, fill = true, preferredRect?: PixelBounds) {
  let next = dilate(mask, width, height, 1);
  next = erode(next, width, height, 1);
  next = erode(next, width, height, 1);
  next = dilate(next, width, height, 1);
  const before = countOnes(next);
  next = retainBestComponent(next, width, height, preferredRect);
  if (fill) next = fillHoles(next, width, height);
  const after = countOnes(next);
  return { mask: next, largestComponentRatio: before ? after / before : 0 };
}

function retainBestComponent(mask: Uint8Array, width: number, height: number, preferredRect?: PixelBounds) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best: number[] = [];
  let bestScore = -1;
  const preferredX = preferredRect ? (preferredRect.left + preferredRect.right) / 2 : width / 2;
  const preferredY = preferredRect ? (preferredRect.top + preferredRect.bottom) / 2 : height / 2;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const component: number[] = [];
    let sumX = 0;
    let sumY = 0;
    while (head < tail) {
      const pixel = queue[head++];
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      sumX += x;
      sumY += y;
      if (x > 0) visit(pixel - 1);
      if (x + 1 < width) visit(pixel + 1);
      if (y > 0) visit(pixel - width);
      if (y + 1 < height) visit(pixel + width);
    }
    const cx = sumX / component.length;
    const cy = sumY / component.length;
    const distance = Math.hypot((cx - preferredX) / width, (cy - preferredY) / height);
    const score = component.length * (1.25 - Math.min(0.55, distance));
    if (score > bestScore) {
      bestScore = score;
      best = component;
    }
    function visit(pixel: number) {
      if (visited[pixel] || !mask[pixel]) return;
      visited[pixel] = 1;
      queue[tail++] = pixel;
    }
  }
  const output = new Uint8Array(mask.length);
  for (const pixel of best) output[pixel] = 1;
  return output;
}

function fillHoles(mask: Uint8Array, width: number, height: number) {
  const background = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  const enqueue = (pixel: number) => {
    if (pixel < 0 || pixel >= mask.length || mask[pixel] || background[pixel]) return;
    background[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }
  const output = mask.slice();
  for (let pixel = 0; pixel < output.length; pixel += 1) if (!mask[pixel] && !background[pixel]) output[pixel] = 1;
  return output;
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let dy = -radius; dy <= radius && !value; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && mask[yy * width + xx]) {
            value = 1;
            break;
          }
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

function erode(mask: Uint8Array, width: number, height: number, radius: number) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 1;
      for (let dy = -radius; dy <= radius && value; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          value = 0;
          break;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || !mask[yy * width + xx]) {
            value = 0;
            break;
          }
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

function featherMask(binary: Uint8Array, width: number, height: number, radius: number) {
  const output = new Uint8Array(binary.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const center = binary[pixel];
      let nearest = radius + 1;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (binary[yy * width + xx] !== center) nearest = Math.min(nearest, Math.hypot(dx, dy));
        }
      }
      if (nearest > radius) output[pixel] = center ? 255 : 0;
      else if (center) output[pixel] = clampByte(128 + (nearest / radius) * 127);
      else output[pixel] = clampByte(128 - (nearest / radius) * 128);
    }
  }
  return output;
}

function scoreSegmentation(input: {
  mode: SegmentationMode;
  image: RgbaImage;
  binaryMask: Uint8Array;
  rawForegroundCount: number;
  largestComponentRatio: number;
  backgroundCoverageRatio: number;
  backgroundColor: [number, number, number] | null;
  backgroundTolerance: number | null;
  energyMargin?: number;
}): SegmentationMetrics {
  const pixels = input.image.width * input.image.height;
  const foreground = countOnes(input.binaryMask);
  const foregroundRatio = ratio(foreground, pixels);
  const edgeContact = edgeForegroundCount(input.binaryMask, input.image.width, input.image.height);
  const perimeter = Math.max(1, input.image.width * 2 + input.image.height * 2 - 4);
  const edgeContactRatio = ratio(edgeContact, perimeter);
  const reasons: string[] = [];
  let score = 100;
  if (foregroundRatio < 4) {
    reasons.push("foreground_too_small");
    score -= 55;
  } else if (foregroundRatio < 8) score -= 18;
  if (foregroundRatio > 88) {
    reasons.push("background_not_removed");
    score -= 55;
  } else if (foregroundRatio > 75) score -= 20;
  if (edgeContactRatio > 12) {
    reasons.push("foreground_touches_edges");
    score -= Math.min(35, Math.round(edgeContactRatio * 1.6));
  }
  if (input.largestComponentRatio < 0.72) {
    reasons.push("multiple_foreground_regions");
    score -= Math.round((0.72 - input.largestComponentRatio) * 60);
  }
  if (input.backgroundCoverageRatio < 8) {
    reasons.push("background_evidence_low");
    score -= 22;
  }
  if (input.mode === "rectangle" && (input.energyMargin || 0) < 0.18) {
    reasons.push("foreground_background_similar");
    score -= 14;
  }
  if (input.rawForegroundCount && foreground / input.rawForegroundCount < 0.45) {
    reasons.push("segmentation_fragmented");
    score -= 12;
  }
  return {
    mode: input.mode,
    score: clampInt(score, 0, 100),
    width: input.image.width,
    height: input.image.height,
    foregroundPixelRatio: round2(foregroundRatio),
    transparentPixelRatio: round2(100 - foregroundRatio),
    edgeContactRatio: round2(edgeContactRatio),
    largestComponentRatio: round3(input.largestComponentRatio),
    backgroundCoverageRatio: round2(input.backgroundCoverageRatio),
    backgroundColor: input.backgroundColor,
    backgroundTolerance: input.backgroundTolerance ? round2(input.backgroundTolerance) : null,
    reasons: unique(reasons),
  };
}

function renderMaskedToCanvas(
  image: RgbaImage,
  mask: Uint8Array,
  targetWidth: number,
  targetHeight: number,
  options: { transparent: boolean; targetFill: number; bounds: PixelBounds; topBias?: number },
): RgbaImage {
  const output = blankImage(targetWidth, targetHeight, options.transparent ? [0, 0, 0, 0] : [255, 255, 255, 255]);
  const availableWidth = targetWidth * options.targetFill;
  const availableHeight = targetHeight * options.targetFill;
  const scale = Math.min(availableWidth / options.bounds.width, availableHeight / options.bounds.height);
  const drawWidth = options.bounds.width * scale;
  const drawHeight = options.bounds.height * scale;
  const offsetX = (targetWidth - drawWidth) / 2;
  const defaultY = (targetHeight - drawHeight) / 2;
  const offsetY = options.topBias === undefined ? defaultY : Math.max(targetHeight * options.topBias, Math.min(defaultY, targetHeight - drawHeight - targetHeight * 0.03));
  const startX = Math.max(0, Math.floor(offsetX));
  const endX = Math.min(targetWidth, Math.ceil(offsetX + drawWidth));
  const startY = Math.max(0, Math.floor(offsetY));
  const endY = Math.min(targetHeight, Math.ceil(offsetY + drawHeight));
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const sourceX = options.bounds.left + (x + 0.5 - offsetX) / scale;
      const sourceY = options.bounds.top + (y + 0.5 - offsetY) / scale;
      const [red, green, blue, alpha] = sampleBilinear(image, sourceX, sourceY, mask);
      const destination = (y * targetWidth + x) * 4;
      if (options.transparent) {
        output.data[destination] = red;
        output.data[destination + 1] = green;
        output.data[destination + 2] = blue;
        output.data[destination + 3] = alpha;
      } else {
        const normalized = alpha / 255;
        output.data[destination] = Math.round(red * normalized + 255 * (1 - normalized));
        output.data[destination + 1] = Math.round(green * normalized + 255 * (1 - normalized));
        output.data[destination + 2] = Math.round(blue * normalized + 255 * (1 - normalized));
        output.data[destination + 3] = 255;
      }
    }
  }
  return output;
}

function sampleBilinear(image: RgbaImage, x: number, y: number, mask?: Uint8Array): [number, number, number, number] {
  const x0 = clampInt(Math.floor(x), 0, image.width - 1);
  const y0 = clampInt(Math.floor(y), 0, image.height - 1);
  const x1 = clampInt(x0 + 1, 0, image.width - 1);
  const y1 = clampInt(y0 + 1, 0, image.height - 1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);
  const sample = (xx: number, yy: number, channel: number) => image.data[(yy * image.width + xx) * 4 + channel];
  const interpolate = (channel: number) => {
    const top = sample(x0, y0, channel) * (1 - tx) + sample(x1, y0, channel) * tx;
    const bottom = sample(x0, y1, channel) * (1 - tx) + sample(x1, y1, channel) * tx;
    return Math.round(top * (1 - ty) + bottom * ty);
  };
  const alphaAt = (xx: number, yy: number) => mask ? mask[yy * image.width + xx] : sample(xx, yy, 3);
  const alphaTop = alphaAt(x0, y0) * (1 - tx) + alphaAt(x1, y0) * tx;
  const alphaBottom = alphaAt(x0, y1) * (1 - tx) + alphaAt(x1, y1) * tx;
  return [interpolate(0), interpolate(1), interpolate(2), Math.round(alphaTop * (1 - ty) + alphaBottom * ty)];
}

function resizeForWorking(image: RgbaImage, maxSide: number): RgbaImage {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  if (width === image.width && height === image.height) return image;
  const output = blankImage(width, height, [0, 0, 0, 0]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sample = sampleBilinear(image, (x + 0.5) / scale - 0.5, (y + 0.5) / scale - 0.5);
      const offset = (y * width + x) * 4;
      output.data[offset] = sample[0];
      output.data[offset + 1] = sample[1];
      output.data[offset + 2] = sample[2];
      output.data[offset + 3] = sample[3];
    }
  }
  return output;
}

function upscaleBinaryMask(mask: Uint8Array, sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = clampInt(Math.floor((y / height) * sourceHeight), 0, sourceHeight - 1);
    for (let x = 0; x < width; x += 1) {
      const sourceX = clampInt(Math.floor((x / width) * sourceWidth), 0, sourceWidth - 1);
      output[y * width + x] = mask[sourceY * sourceWidth + sourceX];
    }
  }
  return output;
}

function upscaleSoftMask(mask: Uint8Array, sourceWidth: number, sourceHeight: number, width: number, height: number) {
  if (sourceWidth === width && sourceHeight === height) return mask.slice();
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + 0.5) / height * sourceHeight - 0.5;
    const y0 = clampInt(Math.floor(sourceY), 0, sourceHeight - 1);
    const y1 = clampInt(y0 + 1, 0, sourceHeight - 1);
    const ty = clamp(sourceY - y0, 0, 1);
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) / width * sourceWidth - 0.5;
      const x0 = clampInt(Math.floor(sourceX), 0, sourceWidth - 1);
      const x1 = clampInt(x0 + 1, 0, sourceWidth - 1);
      const tx = clamp(sourceX - x0, 0, 1);
      const top = mask[y0 * sourceWidth + x0] * (1 - tx) + mask[y0 * sourceWidth + x1] * tx;
      const bottom = mask[y1 * sourceWidth + x0] * (1 - tx) + mask[y1 * sourceWidth + x1] * tx;
      output[y * width + x] = clampByte(top * (1 - ty) + bottom * ty);
    }
  }
  return output;
}

function fitColorModel(image: RgbaImage, indices: number[], k: number): Array<[number, number, number]> {
  if (!indices.length) return [];
  const step = Math.max(1, Math.floor(indices.length / 6000));
  const samples: Array<[number, number, number]> = [];
  for (let index = 0; index < indices.length; index += step) samples.push(colorAt(image, indices[index]));
  return kmeansColors(samples, Math.min(k, samples.length), 7);
}

function kmeansColors(samples: Array<[number, number, number]>, k: number, iterations: number): Array<[number, number, number]> {
  if (!samples.length) return [];
  const centroids: Array<[number, number, number]> = [samples[Math.floor(samples.length / 2)].slice() as [number, number, number]];
  while (centroids.length < k) {
    let farthest = samples[0];
    let farthestDistance = -1;
    for (const sample of samples) {
      const distance = nearestColorDistance(sample, centroids);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = sample;
      }
    }
    centroids.push(farthest.slice() as [number, number, number]);
  }
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sums = Array.from({ length: centroids.length }, () => [0, 0, 0, 0]);
    for (const sample of samples) {
      const cluster = nearestColorIndex(sample, centroids);
      sums[cluster][0] += sample[0];
      sums[cluster][1] += sample[1];
      sums[cluster][2] += sample[2];
      sums[cluster][3] += 1;
    }
    for (let cluster = 0; cluster < centroids.length; cluster += 1) {
      if (!sums[cluster][3]) continue;
      centroids[cluster] = [sums[cluster][0] / sums[cluster][3], sums[cluster][1] / sums[cluster][3], sums[cluster][2] / sums[cluster][3]];
    }
  }
  return centroids;
}

function seedIndices(labels: Uint8Array, hard: Uint8Array, label: number, rect: PixelBounds) {
  const indices: number[] = [];
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    if (hard[pixel] || labels[pixel] === label) indices.push(pixel);
  }
  if (!indices.length) {
    const width = Math.round(Math.sqrt(labels.length));
    const center = Math.round((rect.top + rect.bottom) / 2) * width + Math.round((rect.left + rect.right) / 2);
    indices.push(clampInt(center, 0, labels.length - 1));
  }
  return indices;
}

function markedIndices(marked: Uint8Array) {
  const output: number[] = [];
  for (let pixel = 0; pixel < marked.length; pixel += 1) if (marked[pixel]) output.push(pixel);
  return output;
}

function labelIndices(labels: Uint8Array, label: number, rect: PixelBounds, width: number) {
  const output: number[] = [];
  for (let y = rect.top; y <= rect.bottom; y += 1) for (let x = rect.left; x <= rect.right; x += 1) {
    const pixel = y * width + x;
    if (labels[pixel] === label) output.push(pixel);
  }
  return output;
}

function backgroundIndices(labels: Uint8Array, rect: PixelBounds, width: number, height: number) {
  const output: number[] = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom || labels[pixel] === 0) output.push(pixel);
  }
  return output;
}


function applyPointSeeds(points: NormalizedPoint[], width: number, height: number, labels: Uint8Array, hard: Uint8Array, label: 0 | 1) {
  for (const point of points.slice(0, 48)) {
    const centerX = clampInt(Math.round(clamp(point.x, 0, 1) * (width - 1)), 0, width - 1);
    const centerY = clampInt(Math.round(clamp(point.y, 0, 1) * (height - 1)), 0, height - 1);
    const radius = Math.max(1, Math.round(Math.min(width, height) * 0.018));
    for (let y = centerY - radius; y <= centerY + radius; y += 1) for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x < 0 || x >= width || y < 0 || y >= height || Math.hypot(x - centerX, y - centerY) > radius) continue;
      const pixel = y * width + x;
      labels[pixel] = label;
      hard[pixel] = 1;
    }
  }
}

function estimatePairwiseScale(image: RgbaImage) {
  let total = 0;
  let count = 0;
  for (let y = 0; y < image.height; y += 2) {
    for (let x = 0; x < image.width; x += 2) {
      const pixel = y * image.width + x;
      const color = colorAt(image, pixel);
      if (x + 1 < image.width) {
        total += colorDistanceSquared(color, colorAt(image, pixel + 1));
        count += 1;
      }
      if (y + 1 < image.height) {
        total += colorDistanceSquared(color, colorAt(image, pixel + image.width));
        count += 1;
      }
    }
  }
  return Math.max(600, (total / Math.max(1, count)) * 2.2);
}

function rectToPixels(rect: NormalizedRect, width: number, height: number): PixelBounds {
  const left = clampInt(Math.floor(rect.x * width), 0, width - 1);
  const top = clampInt(Math.floor(rect.y * height), 0, height - 1);
  const right = clampInt(Math.ceil((rect.x + rect.width) * width) - 1, left, width - 1);
  const bottom = clampInt(Math.ceil((rect.y + rect.height) * height) - 1, top, height - 1);
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

function normalizeRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp(rect.x, 0, 0.98);
  const y = clamp(rect.y, 0, 0.98);
  const width = clamp(rect.width, 0.02, 1 - x);
  const height = clamp(rect.height, 0.02, 1 - y);
  return { x, y, width, height };
}

function silhouetteWidth(mask: Uint8Array, width: number, height: number, bounds: PixelBounds, startRatio: number, endRatio: number) {
  const start = clampInt(Math.round(bounds.top + bounds.height * startRatio), bounds.top, bounds.bottom);
  const end = clampInt(Math.round(bounds.top + bounds.height * endRatio), start, bounds.bottom);
  const widths: number[] = [];
  for (let y = start; y <= end; y += 1) {
    let left = width;
    let right = -1;
    for (let x = bounds.left; x <= bounds.right; x += 1) if (mask[y * width + x] >= 128) {
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    if (right >= left) widths.push(right - left + 1);
  }
  return widths.length ? median(widths) : 0;
}

function countOutsideRect(width: number, height: number, rect: PixelBounds) {
  return width * height - rect.width * rect.height;
}

function edgeForegroundCount(mask: Uint8Array, width: number, height: number) {
  let count = 0;
  for (let x = 0; x < width; x += 1) {
    if (mask[x]) count += 1;
    if (height > 1 && mask[(height - 1) * width + x]) count += 1;
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (mask[y * width]) count += 1;
    if (width > 1 && mask[y * width + width - 1]) count += 1;
  }
  return count;
}

function neighbors4(x: number, y: number, width: number, height: number) {
  const output: number[] = [];
  if (x > 0) output.push(y * width + x - 1);
  if (x + 1 < width) output.push(y * width + x + 1);
  if (y > 0) output.push((y - 1) * width + x);
  if (y + 1 < height) output.push((y + 1) * width + x);
  return output;
}

function colorAt(image: RgbaImage, pixel: number): [number, number, number] {
  const offset = pixel * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
}

function nearestColorDistance(color: [number, number, number], centroids: Array<[number, number, number]>) {
  let best = Number.POSITIVE_INFINITY;
  for (const centroid of centroids) best = Math.min(best, colorDistanceSquared(color, centroid));
  return best;
}

function nearestColorIndex(color: [number, number, number], centroids: Array<[number, number, number]>) {
  let bestIndex = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < centroids.length; index += 1) {
    const distance = colorDistanceSquared(color, centroids[index]);
    if (distance < best) {
      best = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function colorDistanceSquared(first: [number, number, number], second: [number, number, number]) {
  const dr = first[0] - second[0];
  const dg = first[1] - second[1];
  const db = first[2] - second[2];
  return dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.8;
}

function nearestNamedColor(rgb: [number, number, number]) {
  const colors: Array<[string, [number, number, number]]> = [
    ["Negro", [20, 20, 22]], ["Blanco", [242, 242, 238]], ["Gris", [128, 128, 128]],
    ["Beige", [202, 184, 151]], ["Marrón", [105, 70, 48]], ["Rojo", [190, 38, 45]],
    ["Naranja", [225, 110, 32]], ["Amarillo", [226, 190, 42]], ["Verde", [58, 126, 76]],
    ["Oliva", [104, 112, 60]], ["Azul", [45, 92, 172]], ["Azul marino", [28, 43, 80]],
    ["Morado", [116, 69, 148]], ["Rosa", [218, 126, 154]], ["Camel", [176, 126, 75]],
  ];
  let best = colors[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of colors) {
    const next = colorDistanceSquared(rgb, candidate[1]);
    if (next < distance) {
      distance = next;
      best = candidate;
    }
  }
  return best[0];
}

function luminance(color: [number, number, number]) {
  return color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
}

function blankImage(width: number, height: number, fill: [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    data[offset] = fill[0];
    data[offset + 1] = fill[1];
    data[offset + 2] = fill[2];
    data[offset + 3] = fill[3];
  }
  return { width, height, data };
}

function validateImage(image: RgbaImage) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS || image.data.length !== image.width * image.height * 4) {
    throw new ZeroVisionError("image_invalid", "The RGBA image dimensions are invalid.");
  }
}

function countOnes(values: Uint8Array) {
  let count = 0;
  for (const value of values) if (value) count += 1;
  return count;
}

function ratio(value: number, total: number) {
  return total ? (value / total) * 100 : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInt(value: number, minimum: number, maximum: number) {
  return Math.round(clamp(value, minimum, maximum));
}

function clampByte(value: number) {
  return clampInt(value, 0, 255);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export class ZeroVisionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
