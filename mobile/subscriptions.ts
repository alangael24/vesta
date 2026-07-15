export const subscriptionProductIds = {
  weekly: "com.alangael.vesta.premium.weekly",
  monthly: "com.alangael.vesta.premium.monthly",
  annual: "com.alangael.vesta.premium.annual",
} as const;

export type SubscriptionPlanId = keyof typeof subscriptionProductIds;

export const subscriptionPlans: Array<{
  id: SubscriptionPlanId;
  productId: string;
  title: string;
  cadence: string;
  description: string;
  badge?: string;
}> = [
  {
    id: "weekly",
    productId: subscriptionProductIds.weekly,
    title: "Semanal",
    cadence: "por semana",
    description: "Para probar todo Premium sin compromiso largo.",
  },
  {
    id: "monthly",
    productId: subscriptionProductIds.monthly,
    title: "Mensual",
    cadence: "por mes",
    description: "Tu armario y probador Premium durante todo el mes.",
    badge: "MÁS POPULAR",
  },
  {
    id: "annual",
    productId: subscriptionProductIds.annual,
    title: "Anual",
    cadence: "por año",
    description: "La mejor opción para usar Outfit Club todo el año.",
    badge: "MEJOR VALOR",
  },
];

export const subscriptionProductIdList = subscriptionPlans.map((plan) => plan.productId);
