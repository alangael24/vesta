import type { OutfitSuggestionGarment } from "./outfit-suggestions";

export type DemoCategory = "tops" | "layers" | "bottoms" | "accessories";

export type DemoWardrobeItem = OutfitSuggestionGarment & {
  category: DemoCategory;
  color: string;
  material: string;
  description: string;
  spriteIndex: number;
  tone: string;
  wears: number;
  daysSinceWorn: number;
  versatility: number;
};

export const demoWardrobe: DemoWardrobeItem[] = [
  { id: "garment-0", spriteIndex: 0, name: "Camiseta negra", category: "tops", type: "Camiseta", color: "Negro", tone: "#20221f", material: "Algodón", wears: 18, daysSinceWorn: 3, versatility: 97, isBasic: true, description: "Una base limpia que absorbe color, textura y capas sin competir." },
  { id: "garment-1", spriteIndex: 1, name: "Polo marino", category: "tops", type: "Polo", color: "Azul marino", tone: "#24354d", material: "Piqué", wears: 11, daysSinceWorn: 8, versatility: 91, isBasic: true, description: "Pulido sin sentirse formal; funciona especialmente bien con tonos arena." },
  { id: "garment-2", spriteIndex: 2, name: "Camiseta cruda", category: "tops", type: "Camiseta", color: "Crudo", tone: "#e7dfce", material: "Algodón", wears: 21, daysSinceWorn: 1, versatility: 99, isBasic: true, description: "Un neutro suave que ilumina capas oscuras y combina con toda la cápsula." },
  { id: "garment-3", spriteIndex: 3, name: "Oxford celeste", category: "tops", type: "Camisa", color: "Azul claro", tone: "#9eb9c9", material: "Oxford", wears: 9, daysSinceWorn: 15, versatility: 86, description: "Ligera, fresca y fácil de llevar abierta o abotonada." },
  { id: "garment-4", spriteIndex: 4, name: "Sobrecamisa cuadro", category: "layers", type: "Sobrecamisa", color: "Azul", tone: "#526679", material: "Franela", wears: 7, daysSinceWorn: 17, versatility: 83, description: "Añade textura y profundidad sin recargar el conjunto." },
  { id: "garment-5", spriteIndex: 5, name: "Polo tejido", category: "tops", type: "Polo", color: "Arena", tone: "#bca27c", material: "Punto", wears: 5, daysSinceWorn: 26, versatility: 84, description: "Textura fina y tono cálido para un look relajado pero intencional." },
  { id: "garment-6", spriteIndex: 6, name: "Jersey avena", category: "layers", type: "Jersey", color: "Avena", tone: "#c9b89c", material: "Lana merino", wears: 12, daysSinceWorn: 10, versatility: 94, isBasic: true, description: "Una capa ligera para mañanas frescas y noches tranquilas." },
  { id: "garment-7", spriteIndex: 7, name: "Chaqueta denim", category: "layers", type: "Chaqueta", color: "Índigo", tone: "#405a72", material: "Denim", wears: 14, daysSinceWorn: 5, versatility: 93, isBasic: true, description: "La capa más versátil del armario: estructurada, familiar y fácil." },
  { id: "garment-8", spriteIndex: 8, name: "Field jacket", category: "layers", type: "Chaqueta", color: "Oliva", tone: "#697056", material: "Sarga", wears: 8, daysSinceWorn: 13, versatility: 90, description: "Bolsillos utilitarios y un verde que armoniza con todos los neutros." },
  { id: "garment-9", spriteIndex: 9, name: "Pantalón óxido", category: "bottoms", type: "Pantalón", color: "Óxido", tone: "#a25c3e", material: "Sarga", wears: 6, daysSinceWorn: 19, versatility: 78, description: "El acento de color de la cápsula: terroso y sorprendentemente combinable." },
  { id: "garment-10", spriteIndex: 10, name: "Chino arena", category: "bottoms", type: "Chino", color: "Arena", tone: "#c4ad82", material: "Algodón", wears: 17, daysSinceWorn: 4, versatility: 96, isBasic: true, description: "Una alternativa luminosa al denim para diario." },
  { id: "garment-11", spriteIndex: 11, name: "Pantalón cacao", category: "bottoms", type: "Pantalón", color: "Cacao", tone: "#665044", material: "Lana fría", wears: 10, daysSinceWorn: 9, versatility: 88, description: "Caída limpia y color profundo para elevar una camiseta básica." },
  { id: "garment-12", spriteIndex: 12, name: "Jean lavado", category: "bottoms", type: "Jeans", color: "Azul claro", tone: "#8aa5bb", material: "Denim", wears: 23, daysSinceWorn: 2, versatility: 95, isBasic: true, description: "Denim cómodo con un lavado suave y espíritu de fin de semana." },
  { id: "garment-13", spriteIndex: 13, name: "Short negro", category: "bottoms", type: "Short", color: "Negro", tone: "#2a2b29", material: "Algodón", wears: 13, daysSinceWorn: 11, versatility: 87, isBasic: true, description: "Minimalista y práctico para días cálidos." },
  { id: "garment-14", spriteIndex: 14, name: "Gorra camel", category: "accessories", type: "Gorra", color: "Camel", tone: "#a97d4f", material: "Algodón", wears: 9, daysSinceWorn: 7, versatility: 76, description: "Un toque cálido y casual que aterriza los looks claros." },
  { id: "garment-15", spriteIndex: 15, name: "Gafas negras", category: "accessories", type: "Gafas", color: "Negro", tone: "#171813", material: "Acetato", wears: 31, daysSinceWorn: 0, versatility: 92, isBasic: true, description: "Montura redonda y discreta para terminar el conjunto." },
];

export const categoryFilters: Array<{ id: "all" | DemoCategory; label: string }> = [
  { id: "all", label: "Todo" },
  { id: "tops", label: "Arriba" },
  { id: "layers", label: "Capas" },
  { id: "bottoms", label: "Abajo" },
  { id: "accessories", label: "Accesorios" },
];

export const occasionOptions = ["Diario", "Trabajo", "Cena", "Viaje"] as const;
export const weatherOptions = ["calor", "templado", "frío", "lluvia"] as const;
export const moodOptions = ["minimal", "relajado", "pulido", "atrevido"] as const;

export function wardrobeItemById(id: string) {
  return demoWardrobe.find((item) => item.id === id);
}
