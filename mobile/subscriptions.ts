export const subscriptionProductIds = {
  weekly: "com.alangael.vesta.premium.weekly",
  monthly: "com.alangael.vesta.premium.monthly",
  annual: "com.alangael.vesta.premium.annual",
} as const;

export type SubscriptionPlanId = keyof typeof subscriptionProductIds;

export const weeklyPlanAllowances = {
  wardrobeAdditions: 50,
  lookGenerations: 150,
} as const;

export const subscriptionPlans: Array<{
  id: SubscriptionPlanId;
  productId: string;
  title: string;
  cadence: string;
  description: string;
  benefits: string[];
  badge?: string;
}> = [
  {
    id: "weekly",
    productId: subscriptionProductIds.weekly,
    title: "Semanal",
    cadence: "por semana",
    description: "50 prendas y 150 Looks nuevos cada semana.",
    benefits: [
      "Añade hasta 50 prendas nuevas por semana",
      "Genera hasta 150 imágenes nuevas de Looks por semana",
      "Abre y comparte tus Looks guardados sin gastar unidades",
      "Combina prendas tuyas con productos de internet",
    ],
  },
  {
    id: "monthly",
    productId: subscriptionProductIds.monthly,
    title: "Mensual",
    cadence: "por mes",
    description: "100 prendas y 250 Looks nuevos cada mes.",
    benefits: [
      "Añade hasta 100 prendas nuevas por mes",
      "Genera hasta 250 imágenes nuevas de Looks por mes",
      "Combina prendas tuyas con productos de internet",
      "Abre y comparte tus Looks guardados sin gastar unidades",
    ],
    badge: "MÁS POPULAR",
  },
  {
    id: "annual",
    productId: subscriptionProductIds.annual,
    title: "Anual",
    cadence: "por año",
    description: "1,200 prendas y 3,000 Looks nuevos durante el año.",
    benefits: [
      "Añade hasta 1,200 prendas nuevas por año",
      "Genera hasta 3,000 imágenes nuevas de Looks por año",
      "Combina prendas tuyas con productos de internet",
      "Abre y comparte tus Looks guardados sin gastar unidades",
    ],
    badge: "MEJOR VALOR",
  },
];

export const subscriptionProductIdList = subscriptionPlans.map((plan) => plan.productId);
