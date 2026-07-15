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

type LocalPhoto = {
  id: string;
  name: string;
  size: number;
  url: string;
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

function loadFavorites(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem("vesta-favorites");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [view, setView] = useState<View>("closet");
  const [filter, setFilter] = useState<Category>("all");
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null);
  const [selectedOutfit, setSelectedOutfit] = useState<Outfit | null>(null);
  const [builderItems, setBuilderItems] = useState<number[]>([2, 9]);
  const [occasion, setOccasion] = useState("Diario");
  const [favorites, setFavorites] = useState<number[]>(loadFavorites);
  const [showImport, setShowImport] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingUrl, setPairingUrl] = useState("");
  const [selectedPhotos, setSelectedPhotos] = useState<LocalPhoto[]>([]);
  const [batchPrepared, setBatchPrepared] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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
    document.body.classList.toggle("sheet-active", Boolean(selectedItem || selectedOutfit || showImport || showCloud));
    return () => document.body.classList.remove("sheet-active");
  }, [selectedItem, selectedOutfit, showImport, showCloud]);

  useEffect(() => {
    return () => selectedPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
  }, [selectedPhotos]);

  const visibleItems = useMemo(
    () => wardrobe.filter((item) => filter === "all" || item.category === filter),
    [filter],
  );

  const selectedPhotoSize = useMemo(
    () => selectedPhotos.reduce((total, photo) => total + photo.size, 0),
    [selectedPhotos],
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

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const prepareBatch = () => {
    if (!selectedPhotos.length) return;
    setBatchPrepared(true);
    setShowImport(false);
    setToast("Lote listo en esta sesión · nada se ha subido");
  };

  const clearBatch = () => {
    setSelectedPhotos([]);
    setBatchPrepared(false);
    setToast("Selección local eliminada");
  };

  const showSampleLooks = () => {
    openView("outfits");
    setToast("Estos looks son una muestra del producto");
  };

  const startPairing = async () => {
    setPairingLoading(true);
    try {
      const response = await fetch("/api/v1/pairing", { method: "POST" });
      if (!response.ok) throw new Error("pairing_failed");
      const result = await response.json() as { pairingUrl: string };
      setPairingUrl(result.pairingUrl);
      window.location.href = result.pairingUrl;
    } catch {
      setToast("No se pudo crear el enlace · vuelve a iniciar sesión");
    } finally {
      setPairingLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => openView("closet")} aria-label="Ir al armario">
          <span className="brand-mark">V</span>
          <span>VESTA</span>
        </button>
        <div className="top-actions">
          <button className="quiet-button" onClick={() => setShowCloud(true)}>App nativa</button>
          <button className="avatar-button" onClick={() => setShowCloud(true)} aria-label="Nube privada de Alan">AL</button>
        </div>
      </header>

      {view === "closet" && (
        <section className="content-section closet-view" aria-labelledby="closet-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Colección de muestra</p>
              <h1 id="closet-title">Armario <span>{wardrobe.length}</span></h1>
            </div>
            <button className="primary-button compact" onClick={() => setShowImport(true)}>
              <span aria-hidden="true">＋</span> Importar fotos
            </button>
          </div>

          {batchPrepared && selectedPhotos.length > 0 && (
            <div className="local-batch" role="status">
              <span className="status-dot" aria-hidden="true" />
              <div>
                <strong>Lote local preparado</strong>
                <small>{selectedPhotos.length} fotos · {formatBytes(selectedPhotoSize)} · sin subir</small>
              </div>
              <button onClick={() => setShowImport(true)}>Revisar</button>
            </div>
          )}

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
            <p>Explora cómo se sentirá el estilista. La personalización con tus prendas se activará cuando conectemos el procesamiento privado.</p>
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

            <button className="generate-button" disabled={!builderItems.length} onClick={showSampleLooks}>
              Ver looks de muestra <span>✦</span>
            </button>
          </div>
        </section>
      )}

      {view === "outfits" && (
        <section className="content-section outfits-view" aria-labelledby="outfits-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Inspiración de muestra</p>
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
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowImport(false)}>
          <section className="import-modal" aria-labelledby="import-title">
            <button className="sheet-close" onClick={() => setShowImport(false)} aria-label="Cerrar">×</button>
            <div className="scan-orbit"><span>✦</span></div>
            <p className="eyebrow">Importación privada</p>
            <h2 id="import-title">Elige las fotos para tu armario.</h2>
            <p>La selección y las miniaturas viven solo en la memoria de este dispositivo. Vesta todavía no sube, guarda ni analiza tus fotos.</p>
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
                      {/* Blob URLs from the phone picker cannot use Next image optimization. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt={`Foto seleccionada ${index + 1}`} />
                      <figcaption>{photo.name}</figcaption>
                    </figure>
                  ))}
                  {selectedPhotos.length > 6 && <div className="more-photos">+{selectedPhotos.length - 6}</div>}
                </div>
                <div className="batch-summary">
                  <strong>{selectedPhotos.length} fotos preparadas</strong>
                  <span>{formatBytes(selectedPhotoSize)} en esta sesión</span>
                </div>
                <button className="primary-button" onClick={prepareBatch}>Dejar lote preparado</button>
                <button className="text-button center danger-text" onClick={clearBatch}>Eliminar selección local</button>
              </>
            )}
            {!selectedPhotos.length && <p className="pipeline-note">La app nativa será la vía principal para subir fotos a la nube privada y seguir su procesamiento.</p>}
          </section>
        </div>
      )}

      {showCloud && (
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowCloud(false)}>
          <section className="install-modal cloud-modal" aria-labelledby="cloud-title">
            <button className="sheet-close" onClick={() => setShowCloud(false)} aria-label="Cerrar">×</button>
            <span className="app-icon-preview">V</span>
            <p className="eyebrow">Backend y panel privado</p>
            <h2 id="cloud-title">Conecta la app nativa.</h2>
            <p>Esta web administra tu nube. D1 guarda el inventario y los trabajos; R2 guarda todas las imágenes sin hacerlas públicas.</p>
            <div className="cloud-facts">
              <div><span>Originales</span><strong>R2 privado</strong></div>
              <div><span>PNG y renders</span><strong>R2 privado</strong></div>
              <div><span>Prendas y estados</span><strong>D1 privado</strong></div>
              <div><span>Acceso</span><strong>Solo Alan</strong></div>
            </div>
            <button className="primary-button" disabled={pairingLoading} onClick={startPairing}>
              {pairingLoading ? "Creando enlace seguro…" : "Emparejar app nativa"}
            </button>
            {pairingUrl && <a className="pairing-link" href={pairingUrl}>Abrir nuevamente en Vesta →</a>}
            <p className="pairing-note">Hazlo desde este teléfono después de instalar la app. El enlace caduca en 10 minutos y solo puede usarse una vez.</p>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
