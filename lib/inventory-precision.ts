export const MIN_INVENTORY_CONFIDENCE = 85;

export type InventoryPrecisionCandidate = {
  confidence: number;
  visibility: "clear" | "partial" | "held";
};

export function isHighPrecisionCandidate(candidate: InventoryPrecisionCandidate) {
  return candidate.visibility === "clear" && candidate.confidence >= MIN_INVENTORY_CONFIDENCE;
}
