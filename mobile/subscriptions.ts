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
    description: "Tu armario y probador Premium durante todo el mes.",
    benefits: [
      "Tu armario privado siempre sincronizado",
      "Prueba outfits completos sobre tu avatar",
      "Combina prendas tuyas con productos de internet",
      "Guarda tus Looks para volver a verlos cuando quieras",
    ],
    badge: "MÁS POPULAR",
  },
  {
    id: "annual",
    productId: subscriptionProductIds.annual,
    title: "Anual",
    cadence: "por año",
    description: "La mejor opción para usar Outfit Club todo el año.",
    benefits: [
      "Tu armario privado siempre sincronizado",
      "Prueba outfits completos sobre tu avatar",
      "Combina prendas tuyas con productos de internet",
      "Guarda tus Looks para volver a verlos cuando quieras",
    ],
    badge: "MEJOR VALOR",
  },
];

export const subscriptionProductIdList = subscriptionPlans.map((plan) => plan.productId);
