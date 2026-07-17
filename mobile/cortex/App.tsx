import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import LegacyApp from "../App";
import {
  BrandHeader,
  BottomNav,
  BriefDayEditor,
  CandidateCard,
  CinematicHero,
  CompareSlider,
  DayStrip,
  EmptyConnection,
  NoticeBanner,
  PlanMetrics,
  RenderQueueTray,
  StyleDNAPanel,
  WardrobeGraphPanel,
  WeekPlanPicker,
  palette,
} from "./components";
import {
  createRenderQueueStorage,
  createRenderTransport,
  loadNativeSnapshot,
  loadStyleProfile,
  loadWeekPlans,
  privateImageSource,
  readCloudSession,
  saveStyleProfile,
  saveWeekPlans,
} from "./cloud";
import { analyzeWardrobe } from "./graph";
import { createStyleProfile, updateStyleProfile } from "./learner";
import {
  attachRenderJobs,
  candidateFromOutfit,
  dateKey,
  findRenderJobForDay,
  longDateLabel,
  nextSevenDayBriefs,
  selectFallbackHero,
  todayFromPlan,
  updateDayBrief,
} from "./logic";
import { planWeekAsync, regeneratePlanDay, togglePlanDayLock } from "./planner";
import type { PlanProgress } from "./planner";
import { RenderCoordinator } from "./renderQueue";
import { generateOutfitCandidates } from "./search";
import type {
  DayBrief,
  LegacyRoute,
  NativeSnapshot,
  Notice,
  OutfitCandidate,
  RenderJob,
  RenderQueueState,
  StyleProfile,
  WardrobeItem,
  WeekPlan,
} from "./types";

const emptySnapshot: NativeSnapshot = {
  wardrobe: [],
  outfits: [],
  calendar: [],
  avatar: null,
  subscription: null,
  updatedAt: "",
};

const emptyQueue: RenderQueueState = { version: 1, jobs: [], updatedAt: "" };

type Tab = "runway" | "lab" | "cortex";

export default function VestaCortexApp() {
  const [tab, setTab] = useState<Tab>("runway");
  const [session, setSession] = useState<Awaited<ReturnType<typeof readCloudSession>>>(null);
  const [snapshot, setSnapshot] = useState<NativeSnapshot>(emptySnapshot);
  const [profile, setProfile] = useState<StyleProfile>(() => createStyleProfile());
  const [briefs, setBriefs] = useState<DayBrief[]>(() => nextSevenDayBriefs());
  const [plans, setPlans] = useState<WeekPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [labCandidates, setLabCandidates] = useState<OutfitCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [queue, setQueue] = useState<RenderQueueState>(emptyQueue);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planningProgress, setPlanningProgress] = useState<PlanProgress | null>(null);
  const [renderingWeek, setRenderingWeek] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [legacyRoute, setLegacyRoute] = useState<LegacyRoute | null>(null);
  const coordinatorRef = useRef<RenderCoordinator | null>(null);
  const planningCancelled = useRef(false);

  const analysis = useMemo(() => analyzeWardrobe(snapshot.wardrobe, snapshot.outfits), [snapshot.wardrobe, snapshot.outfits]);
  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === selectedPlanId) || plans[0] || null, [plans, selectedPlanId]);
  const hydratedPlan = useMemo(() => selectedPlan ? attachRenderJobs(selectedPlan, queue.jobs) : null, [selectedPlan, queue.jobs]);
  const selectedDay = useMemo(() => hydratedPlan?.days.find((day) => day.brief.date === selectedDate) || todayFromPlan(hydratedPlan, selectedDate), [hydratedPlan, selectedDate]);
  const selectedBrief = useMemo(() => briefs.find((brief) => brief.date === selectedDate) || briefs[0], [briefs, selectedDate]);
  const selectedCandidate = useMemo(() => labCandidates.find((candidate) => candidate.id === selectedCandidateId) || labCandidates[0] || null, [labCandidates, selectedCandidateId]);
  const fallbackOutfit = useMemo(() => selectFallbackHero(snapshot), [snapshot]);
  const avatarSource = useMemo(() => privateImageSource(session, snapshot.avatar?.localUri || snapshot.avatar?.mediaPath), [session, snapshot.avatar]);
  const heroJob = findRenderJobForDay(selectedDay, queue.jobs);
  const heroSource = useMemo(() => {
    const local = selectedDay?.localRenderUri || heroJob?.localRenderUri;
    if (local) return { uri: local };
    if (selectedDay?.renderPath || heroJob?.renderPath) return privateImageSource(session, selectedDay?.renderPath || heroJob?.renderPath);
    const matching = selectedDay ? snapshot.outfits.find((outfit) => outfit.pieces.map((item) => String(item.id)).sort().join("|") === selectedDay.candidate.signature && (outfit.localRenderUri || outfit.renderPath)) : null;
    if (matching) return privateImageSource(session, matching.localRenderUri || matching.renderPath);
    return fallbackOutfit ? privateImageSource(session, fallbackOutfit.localRenderUri || fallbackOutfit.renderPath) : null;
  }, [selectedDay, heroJob, snapshot.outfits, session, fallbackOutfit]);

  const renderedDays = useMemo(() => hydratedPlan?.days.filter((day) => {
    const job = findRenderJobForDay(day, queue.jobs);
    return Boolean(day.localRenderUri || job?.localRenderUri || day.renderPath || job?.renderPath);
  }) || [], [hydratedPlan, queue.jobs]);

  const showNotice = (title: string, message?: string, tone: Notice["tone"] = "info") => setNotice({ id: Date.now(), title, message, tone });

  const refresh = async (background = false) => {
    if (!background) setRefreshing(true);
    try {
      const nextSession = await readCloudSession();
      setSession(nextSession);
      if (!nextSession) return;
      const [nextSnapshot, nextProfile, nextPlans] = await Promise.all([
        loadNativeSnapshot(nextSession),
        loadStyleProfile(nextSession),
        loadWeekPlans(nextSession),
      ]);
      setSnapshot(nextSnapshot);
      setProfile(nextProfile);
      setPlans(nextPlans);
      if (nextPlans.length) {
        setSelectedPlanId((current) => current && nextPlans.some((plan) => plan.id === current) ? current : nextPlans[0].id);
        setBriefs(nextPlans[0].days.map((day) => day.brief));
      }
    } catch {
      if (!background) showNotice("Sin conexión", "Vesta conserva el modelo, el plan y los renders disponibles en el dispositivo.", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    (async () => {
      const nextSession = await readCloudSession().catch(() => null);
      if (!active) return;
      setSession(nextSession);
      if (nextSession) {
        const coordinator = new RenderCoordinator(createRenderQueueStorage(nextSession), createRenderTransport(nextSession));
        coordinatorRef.current = coordinator;
        await coordinator.initialize();
        unsubscribe = coordinator.subscribe((next) => active && setQueue(next));
        coordinator.process().catch(() => undefined);
        await refresh(true);
      } else setLoading(false);
    })();
    const appSubscription = AppState.addEventListener("change", (state: string) => {
      if (state === "active") {
        coordinatorRef.current?.resume();
        refresh(true).catch(() => undefined);
      } else coordinatorRef.current?.stop();
    });
    return () => {
      active = false;
      unsubscribe();
      appSubscription.remove();
      coordinatorRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice((current) => current?.id === notice.id ? null : current), notice.tone === "error" ? 5200 : 3400);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!session || !plans.length) return;
    const hydrated = plans.map((plan) => attachRenderJobs(plan, queue.jobs));
    saveWeekPlans(session, hydrated).catch(() => undefined);
  }, [session?.deviceId, plans, queue.updatedAt]);

  const createPlans = async () => {
    if (planning) return;
    const ready = snapshot.wardrobe.filter((item) => item.imageKind === "cutout" && (item.imagePath || item.localImageUri));
    if (ready.length < 3) {
      showNotice("Faltan prendas listas", "Importa o termina al menos una base, una parte inferior —o vestido— y calzado.", "error");
      setLegacyRoute({ view: "closet", action: "import" });
      return;
    }
    planningCancelled.current = false;
    setPlanning(true);
    setPlanningProgress({ phase: "candidates", completed: 0, total: briefs.length, label: "Preparando espacio de búsqueda" });
    try {
      const nextPlans = await planWeekAsync(ready, briefs, profile, {
        seed: `${session?.deviceId || "local"}:${briefs.map((brief) => `${brief.date}:${brief.occasion}:${brief.weather}:${brief.direction}`).join("|")}`,
        existingOutfits: snapshot.outfits,
        iterations: 1800,
        candidatesPerDay: 14,
        beamWidth: 84,
        yieldEvery: 75,
        onProgress: setPlanningProgress,
        shouldCancel: () => planningCancelled.current,
      });
      if (planningCancelled.current) {
        showNotice("Optimización cancelada", "El plan anterior permanece intacto.");
        return;
      }
      if (!nextPlans.length) {
        showNotice("No existe una semana válida", "Revisa anclas o prendas evitadas. Cortex no forzará combinaciones incompatibles.", "error");
        return;
      }
      setPlans(nextPlans);
      setSelectedPlanId(nextPlans[0].id);
      setSelectedDate(nextPlans[0].days[0].brief.date);
      if (session) await saveWeekPlans(session, nextPlans);
      showNotice("Tres semanas optimizadas", `${nextPlans[0].stats.uniqueGarments} prendas únicas y ${nextPlans[0].stats.underusedGarmentsRecovered} piezas recuperadas en la mejor variante.`, "success");
    } finally {
      setPlanning(false);
      setPlanningProgress(null);
    }
  };

  const cancelPlanning = () => {
    planningCancelled.current = true;
    setPlanningProgress((current) => current ? { ...current, label: "Deteniendo búsqueda…" } : current);
  };

  const updatePlan = (next: WeekPlan) => {
    setPlans((current) => current.map((plan) => plan.id === next.id ? next : plan));
  };

  const renderCandidate = async (candidate: OutfitCandidate, quality: "low" | "medium" = "low") => {
    if (!session) {
      setLegacyRoute({ view: "profile", action: "profile" });
      return;
    }
    if (!snapshot.avatar) {
      showNotice("Primero crea tu avatar", "Vesta usará el mismo avatar AI para todas las pruebas y la semana completa.", "error");
      setLegacyRoute({ view: "profile", action: "avatar" });
      return;
    }
    const job = await coordinatorRef.current?.enqueue(candidate.garmentIds, quality);
    if (job) showNotice(quality === "medium" ? "Render editorial en cola" : "Prueba en cola", "Puedes seguir dirigiendo el plan o cerrar la app; la cola se reanuda sola.", "success");
  };

  const renderSelectedDay = () => selectedDay && renderCandidate(selectedDay.candidate, "low");
  const upgradeSelectedDay = () => selectedDay && renderCandidate(selectedDay.candidate, "medium");

  const renderWholeWeek = async () => {
    if (!hydratedPlan || renderingWeek) return;
    if (!snapshot.avatar) {
      setLegacyRoute({ view: "profile", action: "avatar" });
      return;
    }
    setRenderingWeek(true);
    try {
      for (const day of hydratedPlan.days) await coordinatorRef.current?.enqueue(day.candidate.garmentIds, "low");
      showNotice("Semana completa en cola", "Vesta generará cada día de forma secuencial para proteger identidad y evitar trabajos duplicados.", "success");
    } finally {
      setRenderingWeek(false);
    }
  };

  const regenerateSelectedDay = () => {
    if (!selectedPlan || !selectedDay) return;
    const index = selectedPlan.days.findIndex((day) => day.brief.date === selectedDay.brief.date);
    const next = regeneratePlanDay(selectedPlan, index, snapshot.wardrobe, profile, `${Date.now()}:${selectedDay.brief.date}`);
    updatePlan(next);
    showNotice("Día reoptimizado", "Los demás días permanecieron intactos y Cortex evitó repetir la misma fórmula.", "success");
  };

  const toggleSelectedLock = () => {
    if (!selectedPlan || !selectedDay) return;
    const index = selectedPlan.days.findIndex((day) => day.brief.date === selectedDay.brief.date);
    updatePlan(togglePlanDayLock(selectedPlan, index));
  };

  const generateLab = () => {
    const existing = snapshot.outfits.map((outfit) => outfit.pieces.map((item) => String(item.id)).sort().join("|"));
    const candidates = generateOutfitCandidates(snapshot.wardrobe, selectedBrief, profile, { count: 12, beamWidth: 180, seed: `${Date.now()}:${selectedBrief.date}`, existingSignatures: existing });
    setLabCandidates(candidates);
    setSelectedCandidateId(candidates[0]?.id || null);
    if (!candidates.length) showNotice("No hay dirección válida", "Quita un ancla o completa una categoría pendiente.", "error");
    else showNotice("Cortex exploró el armario", `${candidates.length} direcciones distintas sobrevivieron a las restricciones y al filtro de diversidad.`, "success");
  };

  const toggleAnchor = (item: WardrobeItem) => {
    const id = String(item.id);
    const anchors = selectedBrief.anchorGarmentIds.includes(id)
      ? selectedBrief.anchorGarmentIds.filter((value) => value !== id)
      : [...selectedBrief.anchorGarmentIds, id].slice(-2);
    setBriefs((current) => updateDayBrief(current, selectedBrief.date, { anchorGarmentIds: anchors }));
    setLabCandidates([]);
  };

  const giveFeedback = async (kind: "like" | "dislike" | "save" | "wear" | "skip", candidate = selectedCandidate) => {
    if (!candidate) return;
    const next = updateStyleProfile(profile, { kind, candidate, at: new Date().toISOString() });
    setProfile(next);
    if (session) await saveStyleProfile(session, next).catch(() => undefined);
    showNotice(kind === "wear" ? "Outfit registrado" : kind === "dislike" ? "Cortex ajustó el modelo" : "Preferencia aprendida", "El siguiente ranking incorpora esta señal sin enviar tu modelo personal fuera del dispositivo.", "success");
  };

  const handleTabChange = (next: string) => {
    if (next === "closet") setLegacyRoute({ view: "closet" });
    else setTab(next as Tab);
  };

  if (legacyRoute) {
    const key = `${legacyRoute.view}:${legacyRoute.action || ""}:${legacyRoute.outfitId || ""}:${legacyRoute.garmentId || ""}:${(legacyRoute.garmentIds || []).join("|")}`;
    return (
      <View style={{ flex: 1 }}>
        <LegacyApp
          key={key}
          initialView={legacyRoute.view}
          initialAction={legacyRoute.action}
          initialGarmentIds={legacyRoute.garmentIds || []}
          initialOutfitId={legacyRoute.outfitId}
          initialGarmentId={legacyRoute.garmentId}
          autoRenderInitialLook={Boolean(legacyRoute.autoRender)}
          onExit={() => { setLegacyRoute(null); refresh(true).catch(() => undefined); }}
        />
      </View>
    );
  }

  if (loading) {
    return <SafeAreaView style={styles.loading}><StatusBar style="dark" /><View style={styles.loadingMark}><Text style={styles.loadingMarkText}>V</Text></View><Text style={styles.loadingTitle}>Construyendo tu Cortex</Text><Text style={styles.loadingCopy}>Leyendo armario, historial, renders y cola privada.</Text><ActivityIndicator color={palette.cobalt} style={{ marginTop: 18 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <BrandHeader connected={Boolean(session)} avatarSource={avatarSource} onProfile={() => setLegacyRoute({ view: "profile", action: "profile" })} />
      {notice ? <NoticeBanner notice={notice} onClose={() => setNotice(null)} /> : null}
      {!session ? <EmptyConnection onConnect={() => setLegacyRoute({ view: "profile", action: "profile" })} /> : (
        <View style={{ flex: 1 }}>
          {tab === "runway" ? (
            <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(false)} tintColor={palette.cobalt} />} contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
              <View style={styles.titleRow}><View><Text style={styles.eyebrow}>MULTI-OBJECTIVE WEEK PLANNER</Text><Text style={styles.title}>Runway</Text></View><Pressable style={styles.planButton} onPress={planning ? cancelPlanning : createPlans}>{planning ? <Text style={styles.planButtonText}>CANCELAR</Text> : <Text style={styles.planButtonText}>{plans.length ? "REOPTIMIZAR" : "PLANEAR 7 DÍAS"}</Text>}</Pressable></View>
              {planning && planningProgress ? <View style={styles.planningPanel}><ActivityIndicator color={palette.cobalt} /><View style={styles.planningCopy}><Text style={styles.planningTitle}>{planningProgress.label}</Text><View style={styles.planningTrack}><View style={[styles.planningFill, { width: `${Math.round(planningProgress.completed / Math.max(1, planningProgress.total) * 100)}%` }]} /></View></View></View> : null}
              {hydratedPlan ? <>
                <DayStrip days={hydratedPlan.days} selectedDate={selectedDate} onSelect={setSelectedDate} />
                <CinematicHero day={selectedDay} imageSource={heroSource} avatarSource={avatarSource} renderJob={heroJob} onRender={renderSelectedDay} onUpgrade={upgradeSelectedDay} onLock={toggleSelectedLock} onRegenerate={regenerateSelectedDay} onOpenLegacy={() => setLegacyRoute({ view: "profile", action: "avatar" })} />
                <View style={styles.weekActions}><Pressable style={styles.weekRender} onPress={renderWholeWeek} disabled={renderingWeek}><Text style={styles.weekRenderText}>{renderingWeek ? "AÑADIENDO…" : "✦ RENDERIZAR SEMANA"}</Text></Pressable><Pressable style={styles.weekLab} onPress={() => { setTab("lab"); setSelectedDate(selectedDay?.brief.date || selectedDate); }}><Text style={styles.weekLabText}>ABRIR EN LAB</Text></Pressable></View>
                <WeekPlanPicker plans={plans} selectedId={selectedPlan?.id} onSelect={(plan) => { setSelectedPlanId(plan.id); setBriefs(plan.days.map((day) => day.brief)); }} />
                <PlanMetrics plan={hydratedPlan} />
                {renderedDays.length >= 2 ? <View style={styles.compareSection}><Text style={styles.eyebrow}>AI LOOK COMPARE</Text><Text style={styles.sectionTitle}>Desliza entre dos días</Text><CompareSlider left={privateImageSource(session, renderedDays[0].localRenderUri || renderedDays[0].renderPath)!} right={privateImageSource(session, renderedDays[1].localRenderUri || renderedDays[1].renderPath)!} leftLabel={renderedDays[0].brief.label} rightLabel={renderedDays[1].brief.label} /></View> : null}
                <RenderQueueTray jobs={queue.jobs} onRetry={(jobId) => coordinatorRef.current?.retry(jobId)} />
              </> : (
                <View style={styles.noPlan}><Text style={styles.noPlanMark}>7</Text><Text style={styles.noPlanTitle}>Una semana completa, no otro look aislado</Text><Text style={styles.noPlanCopy}>Cortex explora miles de combinaciones, penaliza repeticiones, respeta clima y ocasión, recupera prendas olvidadas y crea tres planes distintos.</Text><Pressable style={styles.noPlanButton} onPress={planning ? cancelPlanning : createPlans}><Text style={styles.noPlanButtonText}>{planning ? "CANCELAR OPTIMIZACIÓN" : "CONSTRUIR MI RUNWAY"}</Text></Pressable></View>
              )}
            </ScrollView>
          ) : tab === "lab" ? (
            <ScrollView contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
              <View style={styles.titleRow}><View><Text style={styles.eyebrow}>CONSTRAINT-BASED OUTFIT SEARCH</Text><Text style={styles.title}>Look Lab</Text></View><Pressable style={styles.planButton} onPress={generateLab}><Text style={styles.planButtonText}>EXPLORAR</Text></Pressable></View>
              <BriefDayEditor brief={selectedBrief} onChange={(patch) => { setBriefs((current) => updateDayBrief(current, selectedBrief.date, patch)); setLabCandidates([]); }} />
              <View style={styles.anchorPanel}><Text style={styles.eyebrow}>HASTA DOS PRENDAS ANCLA</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.anchorRail}>{snapshot.wardrobe.filter((item) => item.imageKind === "cutout" && (item.imagePath || item.localImageUri)).slice(0, 30).map((item) => { const active = selectedBrief.anchorGarmentIds.includes(String(item.id)); const source = privateImageSource(session, item.localImageUri || item.imagePath); return <Pressable key={String(item.id)} style={[styles.anchorCard, active && styles.anchorCardActive]} onPress={() => toggleAnchor(item)}>{source ? <Image source={source} resizeMode="contain" style={styles.anchorImage} /> : null}<Text style={[styles.anchorName, active && styles.anchorNameActive]} numberOfLines={2}>{item.name}</Text>{active ? <View style={styles.anchorCheck}><Text style={styles.anchorCheckText}>✓</Text></View> : null}</Pressable>; })}</ScrollView></View>
              {labCandidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} selected={selectedCandidate?.id === candidate.id} onPress={() => setSelectedCandidateId(candidate.id)} onRender={() => renderCandidate(candidate)} renderJob={queue.jobs.find((job) => job.signature === candidate.signature)} />)}
              {selectedCandidate ? <View style={styles.feedbackPanel}><Text style={styles.eyebrow}>ENSEÑA A CORTEX</Text><Text style={styles.feedbackTitle}>{selectedCandidate.name}</Text><View style={styles.contributionGrid}>{selectedCandidate.contributions.map((entry) => <View key={entry.key} style={styles.contribution}><Text style={styles.contributionValue}>{Math.round(entry.value * 100)}</Text><Text style={styles.contributionLabel}>{entry.label}</Text></View>)}</View><View style={styles.feedbackActions}><FeedbackButton label="ME GUSTA" onPress={() => giveFeedback("like")} /><FeedbackButton label="NO ES PARA MÍ" onPress={() => giveFeedback("dislike")} /><FeedbackButton label="LO USÉ" onPress={() => giveFeedback("wear")} accent /></View><Pressable style={styles.openLegacyButton} onPress={() => setLegacyRoute({ view: "builder", garmentIds: selectedCandidate.garmentIds, autoRender: false })}><Text style={styles.openLegacyText}>EDITAR EN EL PROBADOR ORIGINAL</Text></Pressable></View> : null}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
              <View style={styles.titleRow}><View><Text style={styles.eyebrow}>LOCAL PERSONAL STYLE MODEL</Text><Text style={styles.title}>Cortex</Text></View><Text style={styles.modelCount}>{profile.actionCount} señales</Text></View>
              <StyleDNAPanel dna={analysis.styleDNA} profileActions={profile.actionCount} />
              <WardrobeGraphPanel analysis={analysis} onOpenCloset={() => setLegacyRoute({ view: "closet" })} />
              <View style={styles.communityPanel}><Text style={styles.eyebrow}>COMUNIDADES DEL ARMARIO</Text><Text style={styles.sectionTitle}>Clusters que ya existen</Text>{analysis.communities.slice(0, 6).map((community) => <View key={community.id} style={styles.communityRow}><View style={styles.communityIndex}><Text style={styles.communityIndexText}>{community.id + 1}</Text></View><View style={{ flex: 1 }}><Text style={styles.communityLabel}>{community.label}</Text><Text style={styles.communityMeta}>{community.garmentIds.length} prendas conectadas</Text></View></View>)}</View>
              <RenderQueueTray jobs={queue.jobs} onRetry={(jobId) => coordinatorRef.current?.retry(jobId)} />
            </ScrollView>
          )}
          <BottomNav tab={tab} onChange={handleTabChange} />
        </View>
      )}
    </SafeAreaView>
  );
}

function FeedbackButton({ label, onPress, accent = false }: { label: string; onPress: () => void; accent?: boolean }) {
  return <Pressable style={[styles.feedbackButton, accent && styles.feedbackButtonAccent]} onPress={onPress}><Text style={[styles.feedbackButtonText, accent && styles.feedbackButtonTextAccent]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  screen: { paddingTop: 18, paddingBottom: 108 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.paper },
  loadingMark: { width: 72, height: 72, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: palette.ink },
  loadingMarkText: { color: palette.lime, fontSize: 36, fontWeight: "900" },
  loadingTitle: { color: palette.ink, fontSize: 23, fontWeight: "900", marginTop: 20 }, loadingCopy: { color: palette.muted, fontSize: 8, marginTop: 6 },
  titleRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, marginBottom: 14 },
  eyebrow: { color: palette.cobalt, fontSize: 6.5, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: palette.ink, fontSize: 39, lineHeight: 41, fontWeight: "900", letterSpacing: -1.5 },
  sectionTitle: { color: palette.ink, fontSize: 24, lineHeight: 27, fontWeight: "900", marginTop: 4 },
  planButton: { minWidth: 104, minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, borderRadius: 16, backgroundColor: palette.ink },
  planButtonText: { color: palette.lime, fontSize: 6.5, fontWeight: "900", letterSpacing: .5 },
  planningPanel: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 14, padding: 13, borderRadius: 18, backgroundColor: palette.white },
  planningCopy: { flex: 1 },
  planningTitle: { color: palette.ink, fontSize: 8, fontWeight: "800" },
  planningTrack: { height: 4, overflow: "hidden", marginTop: 7, borderRadius: 2, backgroundColor: palette.line },
  planningFill: { height: 4, borderRadius: 2, backgroundColor: palette.cobalt },
  weekActions: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 14 },
  weekRender: { flex: 1.4, alignItems: "center", paddingVertical: 14, borderRadius: 17, backgroundColor: palette.ink }, weekRenderText: { color: palette.lime, fontSize: 7.5, fontWeight: "900" },
  weekLab: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 17, borderWidth: 1, borderColor: palette.ink }, weekLabText: { color: palette.ink, fontSize: 7.5, fontWeight: "900" },
  compareSection: { marginTop: 6, marginBottom: 20 },
  noPlan: { minHeight: 560, alignItems: "center", justifyContent: "center", marginHorizontal: 16, paddingHorizontal: 30, borderRadius: 30, backgroundColor: palette.ink },
  noPlanMark: { color: palette.lime, fontSize: 86, lineHeight: 92, fontWeight: "900" }, noPlanTitle: { color: palette.white, fontSize: 27, lineHeight: 31, textAlign: "center", fontWeight: "900", marginTop: 15 }, noPlanCopy: { color: "#AEB4BF", fontSize: 9, lineHeight: 15, textAlign: "center", marginTop: 10 }, noPlanButton: { marginTop: 24, paddingHorizontal: 22, paddingVertical: 15, borderRadius: 19, backgroundColor: palette.lime }, noPlanButtonText: { color: palette.ink, fontSize: 7.5, fontWeight: "900" },
  anchorPanel: { marginHorizontal: 16, marginBottom: 16 }, anchorRail: { gap: 8, paddingVertical: 10 }, anchorCard: { width: 102, padding: 7, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.white }, anchorCardActive: { borderColor: palette.cobalt, backgroundColor: palette.cobalt }, anchorImage: { width: "100%", height: 88, borderRadius: 12, backgroundColor: palette.paper }, anchorName: { color: palette.ink, fontSize: 7.5, lineHeight: 10, fontWeight: "800", marginTop: 7 }, anchorNameActive: { color: palette.white }, anchorCheck: { position: "absolute", right: 6, top: 6, width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: palette.lime }, anchorCheckText: { color: palette.ink, fontSize: 10, fontWeight: "900" },
  feedbackPanel: { marginHorizontal: 16, marginTop: 8, padding: 18, borderRadius: 24, backgroundColor: palette.ink }, feedbackTitle: { color: palette.white, fontSize: 24, fontWeight: "900", marginTop: 4 }, contributionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 16 }, contribution: { width: "48.5%", padding: 11, borderRadius: 15, backgroundColor: "#1D2028" }, contributionValue: { color: palette.lime, fontSize: 19, fontWeight: "900" }, contributionLabel: { color: "#AEB4BF", fontSize: 6.5, marginTop: 3 }, feedbackActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 16 }, feedbackButton: { flexGrow: 1, alignItems: "center", paddingHorizontal: 10, paddingVertical: 11, borderRadius: 15, borderWidth: 1, borderColor: "#444A55" }, feedbackButtonAccent: { borderColor: palette.lime, backgroundColor: palette.lime }, feedbackButtonText: { color: palette.white, fontSize: 6.5, fontWeight: "900" }, feedbackButtonTextAccent: { color: palette.ink }, openLegacyButton: { alignItems: "center", marginTop: 10, paddingVertical: 12 }, openLegacyText: { color: "#AEB4BF", fontSize: 6.5, fontWeight: "900", textDecorationLine: "underline" },
  modelCount: { color: palette.success, fontSize: 7, fontWeight: "900", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, backgroundColor: palette.white },
  communityPanel: { marginHorizontal: 16, marginBottom: 16, padding: 18, borderRadius: 24, backgroundColor: palette.white }, communityRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, communityIndex: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: palette.cobaltSoft }, communityIndexText: { color: palette.cobalt, fontSize: 11, fontWeight: "900" }, communityLabel: { color: palette.ink, fontSize: 9, fontWeight: "800" }, communityMeta: { color: palette.muted, fontSize: 6.5, marginTop: 3 },
});
