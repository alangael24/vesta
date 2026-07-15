"use client";

import { ChangeEvent, CSSProperties, useEffect, useMemo, useState } from "react";

type View = "closet" | "builder" | "outfits";
type Category = "all" | "tops" | "layers" | "bottoms" | "accessories";

type WardrobeItem = {
  id: number;
  name: string;
  category: Exclude<Category, "all">;
  type: string;
  color: string;
  material: string;
  description: string;
};

type Outfit = {
  id: number;
  name: string;
  note: string;
  occasion: string;
  pieces: number[];
};

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const wardrobe: WardrobeItem[] = [
  { id: 0, name: "Camiseta negra", category: "tops", type: "Camiseta", color: "Negro", material: "Algodón", description: "Una base limpia para looks sencillos o capas más marcadas." },
  { id: 1, name: "Polo marino", category: "tops", type: "Polo", color: "Azul marino", material: "Piqué", description: "Pulido sin sentirse formal; funciona especialmente bien con tonos arena." },
  { id: 2, name: "Camiseta cruda", category: "tops", type: "Camiseta", color: "Crudo", material: "Algodón", description: "Un neutro suave que combina con toda la cápsula." },
  { id: 3, name: "Oxford celeste", category: "tops", type: "Camisa", color: "Azul claro", material: "Oxford", description: "Ligera, fresca y fácil de llevar abierta o abotonada." },
  { id: 4, name: "Sobrecamisa cuadro", category: "layers", type: "Sobrecamisa", color: "Azul", material: "Franela", description: "Añade textura y profundidad sin recargar el conjunto." },
  { id: 5, name: "Polo tejido", category: "tops", type: "Polo", color: "Arena", material: "Punto", description: "Textura fina y tono cálido para un look relajado pero intencional." },
  { id: 6, name: "Jersey avena", category: "layers", type: "Jersey", color: "Avena", material: "Lana merino", description: "Una capa ligera para mañanas frescas y noches tranquilas." },
  { id: 7, name: "Chaqueta denim", category: "layers", type: "Chaqueta", color: "Índigo", material: "Denim", description: "La capa más versátil del armario: estructurada, familiar y fácil." },
  { id: 8, name: "Field jacket", category: "layers", type: "Chaqueta", color: "Oliva", material: "Sarga", description: "Bolsillos utilitarios y un verde que armoniza con todos los neutros." },
  { id: 9, name: "Pantalón óxido", category: "bottoms", type: "Pantalón", color: "Óxido", material: "Sarga", description: "El acento de color de la cápsula; terroso y sorprendentemente combinable." },
  { id: 10, name: "Chino arena", category: "bottoms", type: "Chino", color: "Arena", material: "Algodón", description: "Una alternativa luminosa al denim para diario." },
  { id: 11, name: "Pantalón cacao", category: "bottoms", type: "Pantalón", color: "Cacao", material: "Lana fría", description: "Caída limpia y color profundo para elevar una camiseta básica." },
  { id: 12, name: "Jean lavado", category: "bottoms", type: "Jeans", color: "Azul claro", material: "Denim", description: "Denim cómodo con un lavado suave y espíritu de fin de semana." },
  { id: 13, name: "Short negro", category: "bottoms", type: "Short", color: "Negro", material: "Algodón", description: "Minimalista y práctico para días cálidos." },
  { id: 14, name: "Gorra camel", category: "accessories", type: "Gorra", color: "Camel", material: "Algodón", description: "Un toque cálido y casual que aterriza los looks claros." },
  { id: 15, name: "Gafas negras", category: "accessories", type: "Gafas", color: "Negro", material: "Acetato", description: "Montura redonda y discreta para terminar el conjunto." },
];

const outfits: Outfit[] = [
  { id: 0, name: "Oliva & óxido", note: "El verde apagado y el pantalón óxido comparten una base terrosa. Las zapatillas claras mantienen el look fresco.", occasion: "Tarde casual", pieces: [8, 9, 2] },
  { id: 1, name: "Marino mediterráneo", note: "Un polo oscuro con chinos arena crea contraste limpio sin parecer demasiado arreglado.", occasion: "Comida", pieces: [1, 10, 15] },
  { id: 2, name: "Negro & cacao", note: "Dos tonos profundos con texturas distintas: sencillo, sobrio y muy fácil de repetir.", occasion: "Cena", pieces: [0, 11, 15] },
  { id: 3, name: "Azul de verano", note: "La camisa celeste y el short marino se sienten ligeros; mangas remangadas para relajar el conjunto.", occasion: "Fin de semana", pieces: [3, 13, 14] },
  { id: 4, name: "Avena & denim", note: "Un jersey crema sobre denim lavado: suave, equilibrado y perfecto para una mañana fresca.", occasion: "Café", pieces: [6, 12, 14] },
  { id: 5, name: "Capas suaves", note: "La sobrecamisa aporta patrón; la camiseta cruda y el chino claro dejan que respire.", occasion: "Trabajo flexible", pieces: [4, 2, 10] },
  { id: 6, name: "Denim ligero", note: "Chaqueta índigo, base cruda y short neutro. Una fórmula útil para transición de clima.", occasion: "Viaje", pieces: [7, 2, 13] },
  { id: 7, name: "Punto cálido", note: "El polo tejido hace eco de la arquitectura cálida y el pantalón óxido suma carácter.", occasion: "Atardecer", pieces: [5, 9, 15] },
];

const filters: { id: Category; label: string }[] = [
  { id: "all", label: "Todo" },
  { id: "tops", label: "Partes de arriba" },
  { id: "layers", label: "Capas" },
  { id: "bottoms", label: "Pantalones" },
  { id: "accessories", label: "Accesorios" },
];

const occasions = ["Diario", "Trabajo", "Cena", "Viaje"];

function spriteStyle(index: number, columns: number, rows: number, image: string): CSSProperties {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = columns === 1 ? 0 : (column / (columns - 1)) * 100;
  const y = rows === 1 ? 0 : (row / (rows - 1)) * 100;
  return {
    backgroundImage: `url(${image})`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
  };
}

function GarmentArt({ item, className = "" }: { item: WardrobeItem; className?: string }) {
  return (
    <div
      className={`garment-art ${className}`}
      style={spriteStyle(item.id, 4, 4, "/wardrobe-sprite.png")}
      role="img"
      aria-label={item.name}
    />
  );
}

function OutfitArt({ outfit, className = "" }: { outfit: Outfit; className?: string }) {
  return (
    <div
      className={`outfit-art ${className}`}
      style={spriteStyle(outfit.id, 4, 2, "/outfit-sprite.png")}
      role="img"
      aria-label={outfit.name}
    />
  );
}

export default function Home() {
  const [view, setView] = useState<View>("closet");
  const [filter, setFilter] = useState<Category>("all");
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null);
  const [selectedOutfit, setSelectedOutfit] = useState<Outfit | null>(null);
  const [builderItems, setBuilderItems] = useState<number[]>([2, 9]);
  const [occasion, setOccasion] = useState("Diario");
  const [favorites, setFavorites] = useState<number[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const stored = window.localStorage.getItem("vesta-favorites");
    if (stored) setFavorites(JSON.parse(stored));
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("vesta-favorites", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    document.body.classList.toggle("sheet-active", Boolean(selectedItem || selectedOutfit || showImport || showInstall));
    return () => document.body.classList.remove("sheet-active");
  }, [selectedItem, selectedOutfit, showImport, showInstall]);

  const visibleItems = useMemo(
    () => wardrobe.filter((item) => filter === "all" || item.category === filter),
    [filter],
  );

  const openView = (next: View) => {
    setView(next);
    setSelectedItem(null);
    setSelectedOutfit(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleFavorite = (id: number) => {
    setFavorites((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const toggleBuilderItem = (id: number) => {
    setBuilderItems((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 3) return [...current.slice(1), id];
      return [...current, id];
    });
    setToast(builderItems.includes(id) ? "Prenda retirada" : "Añadida al look");
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    setFileCount(event.target.files?.length ?? 0);
  };

  const runProgress = (done: () => void) => {
    setProcessing(true);
    setProgress(8);
    let value = 8;
    const interval = window.setInterval(() => {
      value = Math.min(value + Math.floor(Math.random() * 14) + 5, 94);
      setProgress(value);
    }, 180);
    window.setTimeout(() => {
      window.clearInterval(interval);
      setProgress(100);
      window.setTimeout(() => {
        setProcessing(false);
        setProgress(0);
        done();
      }, 350);
    }, 1550);
  };

  const analyzePhotos = () => {
    runProgress(() => {
      setShowImport(false);
      setFileCount(0);
      setToast("6 prendas detectadas y organizadas");
    });
  };

  const generateLooks = () => {
    runProgress(() => {
      openView("outfits");
      setToast("4 looks nuevos listos");
    });
  };

  const installApp = async () => {
    if (!installPrompt) return setShowInstall(true);
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => openView("closet")} aria-label="Ir al armario">
          <span className="brand-mark">V</span>
          <span>VESTA</span>
        </button>
        <div className="top-actions">
          <button className="quiet-button" onClick={installApp}>Instalar</button>
          <button className="avatar-button" aria-label="Perfil de demo">AL</button>
        </div>
      </header>

      {view === "closet" && (
        <section className="content-section closet-view" aria-labelledby="closet-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Tu colección</p>
              <h1 id="closet-title">Armario <span>{wardrobe.length}</span></h1>
            </div>
            <button className="primary-button compact" onClick={() => setShowImport(true)}>
              <span aria-hidden="true">＋</span> Importar fotos
            </button>
          </div>

          <div className="filter-row" aria-label="Filtrar prendas">
            {filters.map((option) => (
              <button
                key={option.id}
                className={filter === option.id ? "active" : ""}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="wardrobe-grid">
            {visibleItems.map((item) => (
              <button className="garment-card" key={item.id} onClick={() => setSelectedItem(item)}>
                <GarmentArt item={item} />
                <span className="card-meta">
                  <strong>{item.name}</strong>
                  <small>{item.type} · {item.color}</small>
                </span>
                {builderItems.includes(item.id) && <span className="selected-dot" aria-label="En el creador">✓</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {view === "builder" && (
        <section className="content-section builder-view" aria-labelledby="builder-title">
          <div className="builder-hero">
            <p className="eyebrow">Estilista personal</p>
            <h1 id="builder-title">Crea un look con lo que ya tienes.</h1>
            <p>Elige hasta tres prendas, cuéntanos el plan y Vesta encuentra combinaciones dentro de tu armario.</p>
          </div>

          <div className="builder-panel">
            <div className="builder-step">
              <div className="step-label"><span>01</span><h2>Prendas base</h2></div>
              <div className="selected-strip">
                {[0, 1, 2].map((slot) => {
                  const item = wardrobe.find((entry) => entry.id === builderItems[slot]);
                  return item ? (
                    <button key={slot} className="selected-item" onClick={() => toggleBuilderItem(item.id)} aria-label={`Quitar ${item.name}`}>
                      <GarmentArt item={item} />
                      <span>×</span>
                    </button>
                  ) : (
                    <button key={slot} className="empty-slot" onClick={() => openView("closet")} aria-label="Añadir prenda">
                      <span>＋</span><small>Añadir</small>
                    </button>
                  );
                })}
              </div>
              <button className="text-button" onClick={() => openView("closet")}>Explorar el armario →</button>
            </div>

            <div className="builder-step">
              <div className="step-label"><span>02</span><h2>¿Cuál es el plan?</h2></div>
              <div className="occasion-grid">
                {occasions.map((option) => (
                  <button key={option} className={occasion === option ? "active" : ""} onClick={() => setOccasion(option)}>
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <button className="generate-button" disabled={!builderItems.length || processing} onClick={generateLooks}>
              {processing ? <><span className="spinner" /> Combinando… {progress}%</> : <>Generar looks <span>✦</span></>}
            </button>
            {processing && <div className="progress-line"><span style={{ width: `${progress}%` }} /></div>}
          </div>
        </section>
      )}

      {view === "outfits" && (
        <section className="content-section outfits-view" aria-labelledby="outfits-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Hechos con tu armario</p>
              <h1 id="outfits-title">Looks <span>{outfits.length}</span></h1>
            </div>
            <button className="primary-button compact" onClick={() => openView("builder")}>Crear otro <span aria-hidden="true">✦</span></button>
          </div>

          <div className="looks-grid">
            {outfits.map((outfit) => (
              <article className="look-card" key={outfit.id}>
                <button className="look-image-button" onClick={() => setSelectedOutfit(outfit)} aria-label={`Abrir ${outfit.name}`}>
                  <OutfitArt outfit={outfit} />
                </button>
                <div className="look-caption">
                  <button onClick={() => setSelectedOutfit(outfit)}>
                    <strong>{outfit.name}</strong><small>{outfit.occasion}</small>
                  </button>
                  <button
                    className={favorites.includes(outfit.id) ? "heart active" : "heart"}
                    onClick={() => toggleFavorite(outfit.id)}
                    aria-label={favorites.includes(outfit.id) ? "Quitar de favoritos" : "Guardar favorito"}
                  >♡</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <nav className="bottom-nav" aria-label="Navegación principal">
        <button className={view === "closet" ? "active" : ""} onClick={() => openView("closet")}>
          <span className="nav-icon">▦</span><small>Armario</small>
        </button>
        <button className={`nav-create ${view === "builder" ? "active" : ""}`} onClick={() => openView("builder")}>
          <span>✦</span><small>Crear</small>
        </button>
        <button className={view === "outfits" ? "active" : ""} onClick={() => openView("outfits")}>
          <span className="nav-icon">▤</span><small>Looks</small>
        </button>
      </nav>

      {selectedItem && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setSelectedItem(null)}>
          <aside className="detail-sheet" aria-label={`Detalle de ${selectedItem.name}`}>
            <button className="sheet-close" onClick={() => setSelectedItem(null)} aria-label="Cerrar">×</button>
            <GarmentArt item={selectedItem} className="detail-art" />
            <div className="detail-content">
              <p className="eyebrow">{selectedItem.type}</p>
              <h2>{selectedItem.name}</h2>
              <p className="detail-description">{selectedItem.description}</p>
              <dl className="facts">
                <div><dt>Color</dt><dd>{selectedItem.color}</dd></div>
                <div><dt>Material</dt><dd>{selectedItem.material}</dd></div>
                <div><dt>Categoría</dt><dd>{filters.find((entry) => entry.id === selectedItem.category)?.label}</dd></div>
              </dl>
              <button className={builderItems.includes(selectedItem.id) ? "secondary-button selected" : "primary-button"} onClick={() => toggleBuilderItem(selectedItem.id)}>
                {builderItems.includes(selectedItem.id) ? "✓ En el creador" : "＋ Usar en un look"}
              </button>
            </div>
          </aside>
        </div>
      )}

      {selectedOutfit && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setSelectedOutfit(null)}>
          <aside className="detail-sheet outfit-sheet" aria-label={`Detalle de ${selectedOutfit.name}`}>
            <button className="sheet-close" onClick={() => setSelectedOutfit(null)} aria-label="Cerrar">×</button>
            <OutfitArt outfit={selectedOutfit} className="detail-outfit-art" />
            <div className="detail-content">
              <p className="eyebrow">{selectedOutfit.occasion}</p>
              <h2>{selectedOutfit.name}</h2>
              <p className="detail-description">{selectedOutfit.note}</p>
              <div className="piece-row" aria-label="Prendas del look">
                {selectedOutfit.pieces.map((piece) => {
                  const item = wardrobe[piece];
                  return <GarmentArt key={piece} item={item} className="piece-art" />;
                })}
              </div>
              <button className={favorites.includes(selectedOutfit.id) ? "secondary-button selected" : "primary-button"} onClick={() => toggleFavorite(selectedOutfit.id)}>
                {favorites.includes(selectedOutfit.id) ? "♥ Guardado" : "♡ Guardar look"}
              </button>
            </div>
          </aside>
        </div>
      )}

      {showImport && (
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && !processing && setShowImport(false)}>
          <section className="import-modal" aria-labelledby="import-title">
            <button className="sheet-close" onClick={() => !processing && setShowImport(false)} aria-label="Cerrar">×</button>
            <div className="scan-orbit"><span>✦</span></div>
            <p className="eyebrow">Importación privada</p>
            <h2 id="import-title">Convierte tus fotos en un armario.</h2>
            <p>Elige fotos de tu carrete. En esta demo no se suben ni se guardan: solo verás cómo funcionaría el flujo.</p>
            <label className="photo-picker">
              <input type="file" accept="image/*" multiple onChange={handleFiles} disabled={processing} />
              <span>{fileCount ? `${fileCount} fotos seleccionadas` : "Elegir fotos del carrete"}</span>
              <small>JPG, PNG o HEIC</small>
            </label>
            <button className="primary-button" disabled={processing} onClick={() => { if (!fileCount) setFileCount(12); else analyzePhotos(); }}>
              {!fileCount ? "Usar fotos de ejemplo" : processing ? `Analizando… ${progress}%` : "Detectar prendas"}
            </button>
            {fileCount > 0 && !processing && <button className="text-button center" onClick={analyzePhotos}>Continuar con {fileCount} fotos →</button>}
            {processing && <div className="progress-line"><span style={{ width: `${progress}%` }} /></div>}
          </section>
        </div>
      )}

      {showInstall && (
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowInstall(false)}>
          <section className="install-modal" aria-labelledby="install-title">
            <button className="sheet-close" onClick={() => setShowInstall(false)} aria-label="Cerrar">×</button>
            <span className="app-icon-preview">V</span>
            <p className="eyebrow">En tu pantalla de inicio</p>
            <h2 id="install-title">Instala Vesta en 20 segundos.</h2>
            <ol>
              <li><span>1</span><p>Abre este enlace en <strong>Safari</strong> en iPhone o <strong>Chrome</strong> en Android.</p></li>
              <li><span>2</span><p>Toca <strong>Compartir</strong> y luego <strong>“Añadir a pantalla de inicio”</strong>.</p></li>
              <li><span>3</span><p>Confirma con <strong>Añadir</strong>. Se abrirá como una app normal.</p></li>
            </ol>
            <button className="primary-button" onClick={() => setShowInstall(false)}>Entendido</button>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
