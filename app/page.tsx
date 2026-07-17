"use client";

import { ChangeEvent, CSSProperties, useEffect, useMemo, useState } from "react";
import { VestaMirror } from "@/app/components/VestaMirror";
import {
  categoryFilters,
  demoWardrobe,
  moodOptions,
  occasionOptions,
  weatherOptions,
  type DemoCategory,
  type DemoWardrobeItem,
} from "@/lib/demo-wardrobe";
import {
  suggestOutfits,
  summarizeWardrobe,
  type OutfitMood,
  type OutfitSuggestion,
  type OutfitWeather,
} from "@/lib/outfit-suggestions";

type View = "today" | "closet" | "studio" | "looks";
type ClosetFilter = "all" | DemoCategory;

type LocalPhoto = {
  id: string;
  name: string;
  size: number;
  url: string;
};

const styleReferences = [{
  source: "photo" as const,
  garments: [demoWardrobe[1], demoWardrobe[10]],
}];

function spriteStyle(index: number): CSSProperties {
  const columns = 4;
  const rows = 4;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    backgroundImage: "url(/wardrobe-sprite.png)",
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${(column / (columns - 1)) * 100}% ${(row / (rows - 1)) * 100}%`,
  };
}

function GarmentArt({ item, className = "" }: { item: DemoWardrobeItem; className?: string }) {
  return (
    <span
      className={`garment-art ${className}`}
      style={spriteStyle(item.spriteIndex)}
      role="img"
      aria-label={item.name}
    />
  );
}

function LookComposition({ items }: { items: DemoWardrobeItem[] }) {
  return (
    <div className="look-composition" aria-label={`Composición de ${items.map((item) => item.name).join(", ")}`}>
      <span className="composition-glow" aria-hidden="true" />
      {items.slice(0, 4).map((item, index) => (
        <GarmentArt key={item.id} item={item} className={`composition-piece piece-${index + 1}`} />
      ))}
      <div className="composition-palette" aria-hidden="true">
        {items.slice(0, 4).map((item) => <i key={item.id} style={{ background: item.tone }} />)}
      </div>
    </div>
  );
}

function readStringArray(key: string) {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readString(key: string) {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) || "";
}

function anchorSlot(item: DemoWardrobeItem) {
  if (item.category !== "accessories") return item.category;
  return /gorra|sombrero|cap|hat/iu.test(`${item.type} ${item.name}`) ? "headwear" : "accessory";
}

function addCompatibleAnchor(current: string[], id: string) {
  const item = demoWardrobe.find((entry) => entry.id === id);
  if (!item || current.includes(id)) return current;
  const slot = anchorSlot(item);
  const withoutConflict = current.filter((currentId) => {
    const currentItem = demoWardrobe.find((entry) => entry.id === currentId);
    return currentItem && anchorSlot(currentItem) !== slot;
  });
  return [...withoutConflict.slice(-1), id];
}

function paletteLabel(family: string) {
  return ({ neutral: "neutros", earth: "tierra", cool: "fríos", warm: "cálidos" } as Record<string, string>)[family] || family;
}

export default function Home() {
  const [view, setView] = useState<View>("today");
  const [filter, setFilter] = useState<ClosetFilter>("all");
  const [occasion, setOccasion] = useState<(typeof occasionOptions)[number]>("Trabajo");
  const [weather, setWeather] = useState<OutfitWeather>("templado");
  const [mood, setMood] = useState<OutfitMood>("pulido");
  const [anchorIds, setAnchorIds] = useState<string[]>(["garment-2"]);
  const [variationSeed, setVariationSeed] = useState(1);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [selectedItem, setSelectedItem] = useState<DemoWardrobeItem | null>(null);
  const [selectedLook, setSelectedLook] = useState<OutfitSuggestion | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => readStringArray("vesta-favorite-signatures"));
  const [plannedSignature, setPlannedSignature] = useState(() => readString("vesta-planned-signature"));
  const [showImport, setShowImport] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<LocalPhoto[]>([]);
  const [batchPrepared, setBatchPrepared] = useState(false);
  const [toast, setToast] = useState("");

  const insights = useMemo(() => summarizeWardrobe(demoWardrobe), []);
  const suggestions = useMemo(() => suggestOutfits(demoWardrobe, 6, new Set(), styleReferences, {
    occasion,
    weather,
    mood,
    seedGarmentIds: anchorIds,
    variationSeed,
  }), [occasion, weather, mood, anchorIds, variationSeed]);
  const activeLook = suggestions[activeSuggestion % suggestions.length];
  const activeItems = useMemo(
    () => activeLook.garmentIds.map((id) => demoWardrobe.find((item) => item.id === id)).filter((item): item is DemoWardrobeItem => Boolean(item)),
    [activeLook],
  );
  const visibleItems = useMemo(
    () => demoWardrobe.filter((item) => filter === "all" || item.category === filter),
    [filter],
  );
  const selectedPhotoSize = useMemo(
    () => selectedPhotos.reduce((total, photo) => total + photo.size, 0),
    [selectedPhotos],
  );
  const overlookedItem = useMemo(
    () => [...demoWardrobe].sort((a, b) => b.daysSinceWorn - a.daysSinceWorn)[0],
    [],
  );

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("vesta-favorite-signatures", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    window.localStorage.setItem("vesta-planned-signature", plannedSignature);
  }, [plannedSignature]);

  useEffect(() => {
    setActiveSuggestion(0);
  }, [occasion, weather, mood, anchorIds]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    document.body.classList.toggle("sheet-active", Boolean(selectedItem || selectedLook || showImport || showCloud));
    return () => document.body.classList.remove("sheet-active");
  }, [selectedItem, selectedLook, showImport, showCloud]);

  useEffect(() => () => {
    selectedPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
  }, [selectedPhotos]);

  const openView = (next: View) => {
    setView(next);
    setSelectedItem(null);
    setSelectedLook(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleAnchor = (id: string) => {
    const removing = anchorIds.includes(id);
    setAnchorIds((current) => removing ? current.filter((value) => value !== id) : addCompatibleAnchor(current, id));
    setToast(removing ? "Prenda retirada del brief" : "Prenda anclada al próximo look");
  };

  const ensureAnchor = (id: string) => {
    setAnchorIds((current) => addCompatibleAnchor(current, id));
    setToast("Prenda anclada al próximo look");
  };

  const regenerate = () => {
    setVariationSeed((current) => current + 7);
    setActiveSuggestion(0);
    setToast("Nueva lectura del mismo armario");
  };

  const toggleFavorite = (signature: string) => {
    setFavorites((current) => current.includes(signature)
      ? current.filter((value) => value !== signature)
      : [...current, signature]);
    setToast(favorites.includes(signature) ? "Look retirado de guardados" : "Look guardado");
  };

  const planLook = (signature: string) => {
    setPlannedSignature(signature);
    setToast("Look reservado para tu próxima salida");
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 40);
    setSelectedPhotos(files.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}`,
      name: file.name,
      size: file.size,
      url: URL.createObjectURL(file),
    })));
    setBatchPrepared(false);
    event.target.value = "";
  };

  const prepareBatch = () => {
    if (!selectedPhotos.length) return;
    setBatchPrepared(true);
    setShowImport(false);
    setToast("Lote local preparado · cero bytes enviados");
  };

  const clearBatch = () => {
    selectedPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
    setSelectedPhotos([]);
    setBatchPrepared(false);
    setToast("Selección local eliminada");
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const itemForLook = (look: OutfitSuggestion) => look.garmentIds
    .map((id) => demoWardrobe.find((item) => item.id === id))
    .filter((item): item is DemoWardrobeItem => Boolean(item));

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => openView("today")} aria-label="Ir al inicio de Vesta">
          <span className="brand-mark">V</span>
          <span className="brand-word">VESTA</span>
        </button>
        <nav className="desktop-nav" aria-label="Navegación principal">
          <button className={view === "today" ? "active" : ""} onClick={() => openView("today")}>Hoy</button>
          <button className={view === "closet" ? "active" : ""} onClick={() => openView("closet")}>Armario</button>
          <button className={view === "studio" ? "active" : ""} onClick={() => openView("studio")}>Studio</button>
          <button className={view === "looks" ? "active" : ""} onClick={() => openView("looks")}>Looks</button>
        </nav>
        <div className="top-actions">
          <span className="private-pill"><i aria-hidden="true" /> Privado por diseño</span>
          <button className="quiet-button" onClick={() => setShowCloud(true)}>App nativa</button>
          <button className="avatar-button" onClick={() => setShowCloud(true)} aria-label="Abrir información de tu nube privada">YO</button>
        </div>
      </header>

      {view === "today" && (
        <section className="content-section today-view" aria-labelledby="today-title">
          <div className="hero-grid">
            <div className="hero-copy">
              <span className="product-kicker"><i aria-hidden="true" /> Tu armario ya sabe más de lo que parece</span>
              <h1 id="today-title">Tu armario,<br /><em>entendido.</em></h1>
              <p className="hero-lead">Vesta convierte prendas dispersas en decisiones claras: qué ponerte, por qué funciona y qué merece volver a rotación.</p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => openView("studio")}>Resolver mi próximo look <span aria-hidden="true">↗</span></button>
                <button className="secondary-button" onClick={() => setShowImport(true)}>Importar fotos</button>
              </div>
              <div className="trust-line">
                <span>Inventario privado</span><span>Recomendación explicable</span><span>Sin compras obligatorias</span>
              </div>
            </div>

            <article className="today-card">
              <div className="today-card-topline">
                <span>Recomendación viva · {occasion}</span>
                <strong>{activeLook.score}% encaje</strong>
              </div>
              <VestaMirror items={activeItems} title={activeLook.name} score={activeLook.score} compact />
              <div className="today-card-copy">
                <div>
                  <span className="micro-label">Para {weather} · dirección {mood}</span>
                  <h2>{activeLook.name}</h2>
                </div>
                <button className={favorites.includes(activeLook.signature) ? "round-action is-active" : "round-action"} onClick={() => toggleFavorite(activeLook.signature)} aria-label="Guardar recomendación">♡</button>
              </div>
              <p>{activeLook.rationale}</p>
              <div className="signal-row">
                {activeLook.signals.slice(0, 3).map((signal) => <span key={signal}>{signal}</span>)}
              </div>
              <button className="card-link" onClick={() => openView("studio")}>Abrir en Vesta Studio <span>→</span></button>
            </article>
          </div>

          <div className="intelligence-strip" aria-label="Lectura del armario">
            <div><span>Prendas entendidas</span><strong>{insights.total}</strong><small>Colección de muestra</small></div>
            <div><span>Looks posibles</span><strong>{insights.outfitPotential}</strong><small>Sin comprar nada</small></div>
            <div><span>Versatilidad</span><strong>{insights.versatilityScore}</strong><small>sobre 100</small></div>
            <div><span>Cobertura</span><strong>{insights.coverageScore}%</strong><small>categorías clave</small></div>
          </div>

          <div className="decision-grid">
            <article className="insight-card insight-wide">
              <span className="card-index">01 / LECTURA</span>
              <div className="insight-content">
                <div>
                  <p className="eyebrow">La oportunidad más clara</p>
                  <h2>{overlookedItem.name} lleva {overlookedItem.daysSinceWorn} días fuera de rotación.</h2>
                </div>
                <div>
                  <p>Vesta no intenta venderte otra prenda. Primero encuentra valor en lo que ya tienes y construye una combinación alrededor.</p>
                  <button className="text-button" onClick={() => { ensureAnchor(overlookedItem.id); openView("studio"); }}>Crear con esta prenda →</button>
                </div>
              </div>
              <GarmentArt item={overlookedItem} className="insight-garment" />
            </article>

            <article className="insight-card palette-card">
              <span className="card-index">02 / PALETA</span>
              <h3>Tu base cromática trabaja a favor.</h3>
              <div className="palette-stack">
                {insights.dominantPalette.map((entry, index) => (
                  <span key={entry.family} style={{ width: `${100 - index * 18}%` }}>
                    <i className={`palette-${entry.family}`} />
                    <b>{paletteLabel(entry.family)}</b><small>{entry.count} prendas</small>
                  </span>
                ))}
              </div>
            </article>

            <article className="insight-card gap-card">
              <span className="card-index">03 / SIGUIENTE MOVIMIENTO</span>
              <h3>{insights.gap}</h3>
              <p>Una recomendación de compra solo aparece cuando cierra una brecha demostrable.</p>
              <button className="text-button" onClick={() => openView("closet")}>Ver cobertura del armario →</button>
            </article>
          </div>

          {batchPrepared && selectedPhotos.length > 0 && (
            <div className="local-batch" role="status">
              <span className="status-dot" aria-hidden="true" />
              <div><strong>Lote local preparado</strong><small>{selectedPhotos.length} fotos · {formatBytes(selectedPhotoSize)} · cero bytes enviados</small></div>
              <button onClick={() => setShowImport(true)}>Revisar</button>
            </div>
          )}
        </section>
      )}

      {view === "closet" && (
        <section className="content-section closet-view" aria-labelledby="closet-title">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Colección de muestra · inteligencia visible</p>
              <h1 id="closet-title">Armario <span>{demoWardrobe.length}</span></h1>
              <p>Cada prenda tiene contexto: uso, versatilidad, color y papel dentro de tus combinaciones.</p>
            </div>
            <button className="primary-button compact" onClick={() => setShowImport(true)}>＋ Importar fotos</button>
          </div>

          <div className="closet-summary">
            <span><b>{demoWardrobe.filter((item) => item.isBasic).length}</b> básicos sólidos</span>
            <span><b>{overlookedItem.daysSinceWorn}</b> días de la prenda olvidada</span>
            <span><b>{anchorIds.length}</b> prendas en el brief</span>
          </div>

          <div className="filter-row" aria-label="Filtrar prendas">
            {categoryFilters.map((option) => (
              <button key={option.id} className={filter === option.id ? "active" : ""} onClick={() => setFilter(option.id)}>{option.label}</button>
            ))}
          </div>

          <div className="wardrobe-grid">
            {visibleItems.map((item) => (
              <article className="garment-card" key={item.id}>
                <button className="garment-open" onClick={() => setSelectedItem(item)} aria-label={`Abrir ${item.name}`}>
                  <GarmentArt item={item} />
                  <span className="versatility-badge">{item.versatility}</span>
                  {anchorIds.includes(item.id) && <span className="selected-dot" aria-label="Prenda anclada">✓</span>}
                </button>
                <div className="card-meta">
                  <button onClick={() => setSelectedItem(item)}><strong>{item.name}</strong><small>{item.type} · {item.color}</small></button>
                  <span><b>{item.wears}</b> usos</span>
                </div>
                <div className="wear-meter" aria-label={`${item.versatility} de versatilidad`}><span style={{ width: `${item.versatility}%` }} /></div>
              </article>
            ))}
          </div>
        </section>
      )}

      {view === "studio" && (
        <section className="content-section studio-view" aria-labelledby="studio-title">
          <div className="studio-heading">
            <p className="eyebrow">Vesta Studio · estilista contextual</p>
            <h1 id="studio-title">Diseña una respuesta,<br /><em>no un collage.</em></h1>
            <p>Define el contexto y Vesta puntúa combinaciones, respeta tus prendas ancla y explica cada decisión.</p>
          </div>

          <div className="studio-grid">
            <aside className="studio-controls">
              <div className="control-section">
                <span className="control-number">01</span>
                <div><h2>¿Cuál es el plan?</h2><p>La ocasión cambia el nivel de estructura y contraste.</p></div>
                <div className="option-grid two-columns">
                  {occasionOptions.map((option) => <button key={option} className={occasion === option ? "active" : ""} onClick={() => setOccasion(option)}>{option}</button>)}
                </div>
              </div>

              <div className="control-section">
                <span className="control-number">02</span>
                <div><h2>Clima y dirección</h2><p>Una recomendación útil debe sobrevivir al mundo real.</p></div>
                <div className="segmented-control" aria-label="Clima">
                  {weatherOptions.map((option) => <button key={option} className={weather === option ? "active" : ""} onClick={() => setWeather(option)}>{option}</button>)}
                </div>
                <div className="segmented-control" aria-label="Dirección de estilo">
                  {moodOptions.map((option) => <button key={option} className={mood === option ? "active" : ""} onClick={() => setMood(option)}>{option}</button>)}
                </div>
              </div>

              <div className="control-section anchor-section">
                <span className="control-number">03</span>
                <div><h2>Prenda ancla</h2><p>Elige hasta dos piezas que Vesta debe resolver.</p></div>
                <div className="anchor-grid">
                  {demoWardrobe.map((item) => (
                    <button key={item.id} className={anchorIds.includes(item.id) ? "active" : ""} onClick={() => toggleAnchor(item.id)} aria-label={`${anchorIds.includes(item.id) ? "Quitar" : "Anclar"} ${item.name}`}>
                      <GarmentArt item={item} /><span>{item.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button className="generate-button" onClick={regenerate}>Generar otra lectura <span>✦</span></button>
            </aside>

            <div className="studio-result">
              <div className="result-sticky">
                <VestaMirror items={activeItems} title={activeLook.name} score={activeLook.score} />
                <div className="result-copy">
                  <div className="result-title-row"><div><span className="micro-label">Opción {activeSuggestion + 1} de {suggestions.length}</span><h2>{activeLook.name}</h2></div><strong>{activeLook.score}%</strong></div>
                  <p>{activeLook.rationale}</p>
                  <div className="signal-row">{activeLook.signals.map((signal) => <span key={signal}>{signal}</span>)}</div>
                  <div className="result-actions">
                    <button className="primary-button" onClick={() => planLook(activeLook.signature)}>{plannedSignature === activeLook.signature ? "✓ Planificado" : "Planificar look"}</button>
                    <button className={favorites.includes(activeLook.signature) ? "secondary-button is-active" : "secondary-button"} onClick={() => toggleFavorite(activeLook.signature)}>{favorites.includes(activeLook.signature) ? "♥ Guardado" : "♡ Guardar"}</button>
                  </div>
                </div>
                <div className="suggestion-switcher" aria-label="Alternativas de look">
                  {suggestions.map((suggestion, index) => (
                    <button key={suggestion.signature} className={activeSuggestion === index ? "active" : ""} onClick={() => setActiveSuggestion(index)}>
                      <span>{String(index + 1).padStart(2, "0")}</span><b>{suggestion.name}</b><small>{suggestion.score}%</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {view === "looks" && (
        <section className="content-section looks-view" aria-labelledby="looks-title">
          <div className="page-heading">
            <div><p className="eyebrow">Generados desde tu contexto actual</p><h1 id="looks-title">Looks <span>{suggestions.length}</span></h1><p>{occasion} · {weather} · {mood}. Cambia el brief en Studio para transformar la selección.</p></div>
            <button className="primary-button compact" onClick={() => openView("studio")}>Ajustar brief <span>✦</span></button>
          </div>
          <div className="looks-grid">
            {suggestions.map((look, index) => {
              const lookItems = itemForLook(look);
              return (
                <article className="look-card" key={look.signature}>
                  <button className="look-open" onClick={() => setSelectedLook(look)} aria-label={`Abrir ${look.name}`}>
                    <LookComposition items={lookItems} />
                    <span className="look-rank">{String(index + 1).padStart(2, "0")}</span>
                    <span className="look-score">{look.score}%</span>
                  </button>
                  <div className="look-caption">
                    <button onClick={() => setSelectedLook(look)}><strong>{look.name}</strong><small>{look.occasion} · {look.signals[0]}</small></button>
                    <button className={favorites.includes(look.signature) ? "heart active" : "heart"} onClick={() => toggleFavorite(look.signature)} aria-label="Guardar look">♡</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <nav className="bottom-nav" aria-label="Navegación móvil">
        <button className={view === "today" ? "active" : ""} onClick={() => openView("today")}><span>⌂</span><small>Hoy</small></button>
        <button className={view === "closet" ? "active" : ""} onClick={() => openView("closet")}><span>▦</span><small>Armario</small></button>
        <button className={`nav-create ${view === "studio" ? "active" : ""}`} onClick={() => openView("studio")}><span>✦</span><small>Studio</small></button>
        <button className={view === "looks" ? "active" : ""} onClick={() => openView("looks")}><span>▤</span><small>Looks</small></button>
      </nav>

      {selectedItem && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setSelectedItem(null)}>
          <aside className="detail-sheet" aria-label={`Detalle de ${selectedItem.name}`}>
            <button className="sheet-close" onClick={() => setSelectedItem(null)} aria-label="Cerrar">×</button>
            <div className="detail-visual"><GarmentArt item={selectedItem} className="detail-art" /><span className="detail-score">{selectedItem.versatility}<small>versatilidad</small></span></div>
            <div className="detail-content">
              <p className="eyebrow">{selectedItem.type}</p>
              <h2>{selectedItem.name}</h2>
              <p className="detail-description">{selectedItem.description}</p>
              <dl className="facts">
                <div><dt>Color</dt><dd><i style={{ background: selectedItem.tone }} />{selectedItem.color}</dd></div>
                <div><dt>Material</dt><dd>{selectedItem.material}</dd></div>
                <div><dt>Rotación</dt><dd>{selectedItem.daysSinceWorn === 0 ? "Hoy" : `Hace ${selectedItem.daysSinceWorn} días`}</dd></div>
                <div><dt>Uso registrado</dt><dd>{selectedItem.wears} veces</dd></div>
              </dl>
              <button className={anchorIds.includes(selectedItem.id) ? "secondary-button selected" : "primary-button"} onClick={() => toggleAnchor(selectedItem.id)}>{anchorIds.includes(selectedItem.id) ? "✓ En el brief" : "＋ Resolver esta prenda"}</button>
              <button className="text-button center" onClick={() => { ensureAnchor(selectedItem.id); setSelectedItem(null); openView("studio"); }}>Abrir en Studio →</button>
            </div>
          </aside>
        </div>
      )}

      {selectedLook && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setSelectedLook(null)}>
          <aside className="detail-sheet look-sheet" aria-label={`Detalle de ${selectedLook.name}`}>
            <button className="sheet-close" onClick={() => setSelectedLook(null)} aria-label="Cerrar">×</button>
            <VestaMirror items={itemForLook(selectedLook)} title={selectedLook.name} score={selectedLook.score} compact />
            <div className="detail-content">
              <p className="eyebrow">{selectedLook.occasion}</p>
              <h2>{selectedLook.name}</h2>
              <p className="detail-description">{selectedLook.rationale}</p>
              <div className="signal-row">{selectedLook.signals.map((signal) => <span key={signal}>{signal}</span>)}</div>
              <div className="piece-row" aria-label="Prendas del look">{itemForLook(selectedLook).map((item) => <GarmentArt key={item.id} item={item} className="piece-art" />)}</div>
              <button className="primary-button" onClick={() => planLook(selectedLook.signature)}>{plannedSignature === selectedLook.signature ? "✓ Look planificado" : "Planificar este look"}</button>
              <button className={favorites.includes(selectedLook.signature) ? "secondary-button selected" : "secondary-button"} onClick={() => toggleFavorite(selectedLook.signature)}>{favorites.includes(selectedLook.signature) ? "♥ Guardado" : "♡ Guardar look"}</button>
            </div>
          </aside>
        </div>
      )}

      {showImport && (
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowImport(false)}>
          <section className="import-modal" aria-labelledby="import-title">
            <button className="sheet-close" onClick={() => setShowImport(false)} aria-label="Cerrar">×</button>
            <div className="scan-orbit"><span>✦</span></div>
            <p className="eyebrow">Importación privada</p>
            <h2 id="import-title">Elige las fotos para tu armario.</h2>
            <p>Esta demo conserva miniaturas únicamente en la memoria del dispositivo. La app nativa gestiona la carga privada y el procesamiento real.</p>
            <div className="privacy-status"><span className="status-dot" aria-hidden="true" /> Selección local · envío desactivado</div>
            <label className="photo-picker">
              <input type="file" accept="image/*" multiple onChange={handleFiles} />
              <span>{selectedPhotos.length ? "Cambiar selección" : "Elegir fotos del carrete"}</span>
              <small>JPG, PNG o HEIC · máximo 40</small>
            </label>
            {selectedPhotos.length > 0 && (
              <>
                <div className="photo-preview-grid" aria-label="Fotos seleccionadas">
                  {selectedPhotos.slice(0, 6).map((photo, index) => (
                    <figure key={photo.id}>
                      {/* Blob URLs del selector local no pasan por la optimización de Next. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt={`Foto seleccionada ${index + 1}`} />
                      <figcaption>{photo.name}</figcaption>
                    </figure>
                  ))}
                  {selectedPhotos.length > 6 && <div className="more-photos">+{selectedPhotos.length - 6}</div>}
                </div>
                <div className="batch-summary"><strong>{selectedPhotos.length} fotos preparadas</strong><span>{formatBytes(selectedPhotoSize)} · local</span></div>
                <button className="primary-button" onClick={prepareBatch}>Dejar lote preparado</button>
                <button className="text-button center danger-text" onClick={clearBatch}>Eliminar selección local</button>
              </>
            )}
            {!selectedPhotos.length && <p className="pipeline-note">La importación real usa la app nativa, una cola reanudable y almacenamiento privado por cuenta.</p>}
          </section>
        </div>
      )}

      {showCloud && (
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowCloud(false)}>
          <section className="install-modal cloud-modal" aria-labelledby="cloud-title">
            <button className="sheet-close" onClick={() => setShowCloud(false)} aria-label="Cerrar">×</button>
            <span className="app-icon-preview">V</span>
            <p className="eyebrow">App nativa y nube privada</p>
            <h2 id="cloud-title">La experiencia completa vive en tu cuenta.</h2>
            <p>La app nativa importa fotos, reanuda trabajos, sincroniza el armario, genera recortes y activa el probador visual.</p>
            <div className="cloud-facts">
              <div><span>Originales</span><strong>R2 privado</strong></div>
              <div><span>PNG y renders</span><strong>R2 privado</strong></div>
              <div><span>Inventario y estados</span><strong>D1 privado</strong></div>
              <div><span>Vista web</span><strong>Demo local</strong></div>
            </div>
            <p className="pairing-note">No necesitas emparejar nada ni copiar enlaces. Cada cuenta queda aislada automáticamente.</p>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
