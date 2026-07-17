# Vesta

**Tu armario, entendido.**

Vesta convierte fotos de ropa en un armario privado y estructurado, aprende de las combinaciones que ya usas y transforma ese contexto en decisiones concretas: **qué ponerte, por qué funciona y qué merece volver a rotación**.

No es otro catálogo de prendas ni una excusa para comprar más. El producto empieza por extraer más valor de lo que ya tienes.

## La promesa del producto

Vesta debe cerrar este ciclo completo:

1. **Capturar** — importar fotos de forma privada y reanudable.
2. **Entender** — detectar prendas, deduplicarlas, reconstruir recortes limpios y conservar evidencia.
3. **Decidir** — recomendar looks según ocasión, clima, dirección de estilo y prendas ancla.
4. **Explicar** — mostrar las señales que hicieron fuerte una combinación.
5. **Visualizar** — comprobar color, proporción y capas antes de guardar o planificar.
6. **Aprender** — usar fotos y looks guardados como referencias del estilo personal.

## Qué existe hoy

### Vesta Studio — web

La web es una demostración interactiva del sistema de decisión:

- recomendación diaria y diagnóstico del armario;
- análisis de versatilidad, cobertura, paleta y prendas fuera de rotación;
- brief por ocasión, clima, dirección de estilo y hasta dos prendas ancla;
- recomendaciones puntuadas, explicables, guardables y planificables;
- **Vesta Mirror**, una composición vectorial 2.5D para revisar silueta, color y capas.

La selección de fotos de la web es deliberadamente local: crea miniaturas en memoria, pero no sube ni procesa archivos. La experiencia de importación real vive en la app nativa.

### App nativa — Expo / React Native

La app nativa contiene el flujo operativo completo:

- importación desde la galería con cola persistente y reanudable;
- conexión segura por dispositivo y caché local privada;
- sincronización del armario, recortes y Looks;
- edición de metadatos y control de calidad;
- avatar, probador visual y renders de looks;
- calendario de outfits, wishlist y suscripción.

### Backend — vinext / Cloudflare

El backend usa:

- **D1** para usuarios, dispositivos, lotes, trabajos, prendas, outfits y calendario;
- **R2 privado** para originales, recortes y renders;
- rutas autenticadas por dispositivo;
- inventario incremental, deduplicación y reconstrucción con controles de calidad;
- respuestas privadas y sin caché para datos personales.

## Una decisión importante sobre 3D

Vesta no llama “3D” a una superposición que no conoce medidas corporales, patrón, tejido ni caída física.

**Vesta Mirror** es una vista 2.5D honesta: ayuda a evaluar composición, proporción visual, color y profundidad de capas. No promete talla ni ajuste corporal. El probador generativo de la app nativa es una visualización de estilo, no una garantía de fit.

Una simulación 3D real solo tendría sentido cuando el producto disponga de:

- geometría o patrones de la prenda;
- medidas corporales fiables;
- propiedades físicas del tejido;
- calibración y validación de error visibles para el usuario.

Hasta entonces, una visualización clara y honesta aporta más valor que una falsa precisión.

## Motor de estilo contextual

`lib/outfit-suggestions.ts` genera combinaciones deterministas y diversas a partir de:

- compatibilidad cromática;
- estructura de outfit completa;
- ocasión;
- clima;
- dirección de estilo;
- prendas ancla y prendas a evitar;
- afinidad con fotos y Looks guardados;
- firmas existentes para no repetir combinaciones.

El motor también produce una puntuación de afinidad y señales legibles, además de un resumen del potencial del armario.

## Estructura

```text
app/
  page.tsx                         Vesta Studio web
  components/VestaMirror.tsx       visualizador 2.5D honesto
  api/v1/                          API privada de Vesta
lib/
  outfit-suggestions.ts            motor contextual y diagnóstico
  inventory.ts                     extracción de inventario
  deduplication.ts                 detección de duplicados
  reconstruction.ts                reconstrucción de prendas
mobile/
  App.tsx                           cliente nativo actual
db/
  schema.ts                         modelo D1
tests/                              pruebas de producto y pipeline
```

## Desarrollo

### Requisitos

- Node.js `>=22.13.0`
- pnpm

### Web y backend

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
```

### App nativa

```bash
cd mobile
pnpm install
pnpm start
```

También están disponibles:

```bash
pnpm android
pnpm ios
pnpm typecheck
```

## Privacidad

- Los originales y derivados permanecen en almacenamiento privado por cuenta.
- Las rutas de datos personales requieren identidad de dispositivo.
- La demo web no transmite las fotos seleccionadas.
- Los flujos de procesamiento declaran explícitamente su política de retención.
- La app permite borrar datos privados locales.

Consulta la [política de privacidad](app/privacy/page.tsx) para el detalle orientado a usuario.

## Criterio de producto

Cada nueva función debería responder “sí” al menos a una de estas preguntas:

- ¿reduce el tiempo hasta decidir qué ponerse?
- ¿hace visible algo útil que el usuario no sabía de su armario?
- ¿recupera valor de prendas que ya posee?
- ¿mejora la confianza sin fingir precisión?
- ¿protege mejor los datos personales?

Si solo añade espectáculo, no es Vesta.
