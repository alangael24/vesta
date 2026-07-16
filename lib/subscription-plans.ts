export const subscriptionProductIds = {
  weekly: "com.alangael.vesta.premium.weekly",
  monthly: "com.alangael.vesta.premium.monthly",
  annual: "com.alangael.vesta.premium.annual",
} as const;

export const weeklyAllowances = {
  wardrobeAddition: 50,
  lookGeneration: 150,
} as const;

export const subscriptionProducts = new Set<string>(Object.values(subscriptionProductIds));
