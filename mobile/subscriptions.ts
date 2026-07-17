export const subscriptionProductIds = {
  weekly: "com.alangael.vesta.premium.weekly",
  monthly: "com.alangael.vesta.premium.monthly",
  annual: "com.alangael.vesta.premium.annual",
} as const;

export type SubscriptionPlanId = keyof typeof subscriptionProductIds;

export const planCredits = {
  weekly: 150,
  monthly: 250,
  annual: 3_000,
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
    description: "150 créditos para crear cada semana.",
    benefits: [
      "150 créditos renovados cada semana",
      "Agregar una prenda usa 1 crédito",
      "Generar la imagen de un outfit usa 1 crédito",
      "Abre y comparte tus Looks guardados sin gastar unidades",
      "Combina prendas tuyas con productos de internet",
    ],
  },
  {
    id: "monthly",
    productId: subscriptionProductIds.monthly,
    title: "Mensual",
    cadence: "por mes",
    description: "250 créditos para crear cada mes.",
    benefits: [
      "250 créditos renovados cada mes",
      "Agregar una prenda usa 1 crédito",
      "Generar la imagen de un outfit usa 1 crédito",
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
    description: "3,000 créditos para crear durante el año.",
    benefits: [
      "3,000 créditos renovados cada año",
      "Agregar una prenda usa 1 crédito",
      "Generar la imagen de un outfit usa 1 crédito",
      "Combina prendas tuyas con productos de internet",
      "Abre y comparte tus Looks guardados sin gastar unidades",
    ],
    badge: "MEJOR VALOR",
  },
];

export const subscriptionProductIdList = subscriptionPlans.map((plan) => plan.productId);
