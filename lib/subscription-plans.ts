export const subscriptionProductIds = {
  weekly: "com.alangael.vesta.premium.weekly",
  monthly: "com.alangael.vesta.premium.monthly",
  annual: "com.alangael.vesta.premium.annual",
} as const;

export const subscriptionAllowances = {
  [subscriptionProductIds.weekly]: { wardrobeAddition: 50, lookGeneration: 150 },
  [subscriptionProductIds.monthly]: { wardrobeAddition: 100, lookGeneration: 250 },
  [subscriptionProductIds.annual]: { wardrobeAddition: 1_200, lookGeneration: 3_000 },
} as const;

export function allowancesForProduct(productId: string) {
  return subscriptionAllowances[productId as keyof typeof subscriptionAllowances] || null;
}

export const subscriptionProducts = new Set<string>(Object.values(subscriptionProductIds));
