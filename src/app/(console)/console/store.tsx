"use client";

// L'état de la console et ses gestes, partagés par les quatre vues (relecture,
// accueil, historique, suivi) : la file, la portée du rail, l'article ouvert,
// qui je suis. Hérité de l'état global de l'ancien front HTML (supprimé), mais
// sans état global de module : un contexte React, posé par la coque, qui
// survit aux navigations entre les vues (le layout ne se remonte pas).

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setScoringSettings } from "@shared/scoring.js";
import { setCoverage } from "@shared/zones.js";
import { can, writtenByMock, MOCK_PUBLISH_REFUSAL } from "@shared/model.js";
import { illustrationBlocked, ILLUSTRATION_REFUSAL } from "@shared/feats.js";
import { useFlash } from "@/composants/Toast";
import { appliquerTheme, usePrefs } from "@/composants/prefs";
import type { Moi } from "@/seConnecter/seConnecter.regles";
import type { Notification } from "@/suivreNotifications/suivreNotifications.regles";
import {
  criteresManquants, deptParDefaut, filteredIndex, refusConformite, ligneApresDecision, ligneDepuisArticle, nextPending, organisationParSource, remplacerLigne,
  type Article, type Ligne, type Portee, type SourceRef,
} from "@/relireArticles/relireArticles.regles";
import * as client from "@/relireArticles/relireArticles.client";
import { changerStatut, publier, regenerer, relireMoi, voirComme } from "@/relireArticles/relireArticles.action";
import { messageRegeneration, type ChecksRegen } from "@/relireArticles/relireArticles.regen";
import { calculsLigne, DELAI_PERSISTANCE_MS, fusionnerPatch, type Modification, type Patch } from "@/editerArticle/editerArticle.regles";
import { patcherArticle } from "@/editerArticle/editerArticle.action";

export type Modale = null | { kind: "prefs" | "ticket" | "reai" | "raccourcis" } | { kind: "notifs"; liste: Notification[] };

export interface Console {
  index: Ligne[];
  /* Le référentiel des sources, pour le filtre « source » du rail (M3-59). */
  referentiel: SourceRef[];
  sel: Article | null;
  selId: string | null;
  portee: Portee;
  moi: Moi;
  notifCount: number;
  modale: Modale;
  // gestes
  selectArticle: (id: string | null) => Promise<void>;
  loadIndex: () => Promise<void>;
  setPortee: (patch: Partial<Portee>, ouvrirPremier?: boolean) => void;
  gotoFile: (o: { zone?: string; kind?: string; focus?: string }) => Promise<void>;
  openFromHistory: (id: string) => Promise<void>;
  decide: (status: string, verb: string, icone: string) => Promise<void>;
  publishArticle: (scheduledAt: string | null) => Promise<void>;
  regenerate: (alt: string | null, force: boolean) => Promise<void>;
  changeRole: (role: string) => Promise<void>;
  setNotifCount: (n: number) => void;
  ouvrirModale: (m: Modale) => void;
  /* Lit la liste, puis ouvre la fenêtre avec : la modale n'a rien à charger. */
  ouvrirNotifications: () => Promise<void>;
  fermerModale: () => void;
  // édition
  editer: (m: Modification | null) => void;
  editerMaintenant: (m: Modification | null) => Promise<void>;
  flushPersist: () => Promise<void>;
}

const Ctx = createContext<Console | null>(null);

export function useConsole(): Console {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConsole hors de ConsoleProvider");
  return c;
}

export function ConsoleProvider({ moiInitial, indexInitial, sourcesInitiales, notifsInitiales, children }: { moiInitial: Moi; indexInitial: Ligne[]; sourcesInitiales: SourceRef[]; notifsInitiales: number; children: ReactNode }) {
  const flash = useFlash();
  const router = useRouter();
  const prefs = usePrefs();
  const [index, setIndex] = useState<Ligne[]>(indexInitial);
  const [sel, setSel] = useState<Article | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [moi, setMoi] = useState<Moi>(moiInitial);
  const [notifCount, setNotifCount] = useState(notifsInitiales);
  const [modale, setModale] = useState<Modale>(null);
  const [porteeBase, setPorteeBase] = useState<Omit<Portee, "prefsDepts">>(() => ({
    zone: "hab", dept: deptParDefaut(indexInitial, moiInitial.defaultDept, "hab"), kind: "", sourceFilter: "", focus: "",
  }));
  const referentiel = sourcesInitiales;
  const orgDe = useMemo(() => organisationParSource(referentiel), [referentiel]);
  const portee = useMemo<Portee>(() => ({ ...porteeBase, prefsDepts: (prefs.depts as string[] | undefined) || [], orgDe }), [porteeBase, prefs.depts, orgDe]);

  /* Les modules partagés (scoring, zones) tiennent leurs réglages en variable de
     module : on les y pose dès qu'on les connaît — un système externe à React. */
  useEffect(() => {
    if (moi.scoring) setScoringSettings(moi.scoring);
    if (moi.zonesCovered) setCoverage(moi.zonesCovered);
    appliquerTheme(moi.feats);
  }, [moi]);

  /* Toujours la dernière valeur, pour les gestes asynchrones et le clavier ;
     mise à jour après chaque rendu, jamais pendant. */
  const ref = useRef({ index, sel, selId, portee, moi });
  useEffect(() => { ref.current = { index, sel, selId, portee, moi }; });

  /* ---------- édition : patch différé ---------- */
  const pending = useRef<Patch>({});
  const timer = useRef<number | undefined>(undefined);

  const syncRow = useCallback((a: Article) => {
    setIndex((idx) => {
      const row = idx.find((r) => r.id === a.id);
      return row ? remplacerLigne(idx, ligneDepuisArticle(row, a, calculsLigne(a))) : idx;
    });
  }, []);

  const flushPersist = useCallback(async () => {
    window.clearTimeout(timer.current);
    const cible = ref.current.sel;
    if (!cible || !Object.keys(pending.current).length) return;
    const patch = pending.current; pending.current = {};
    const r = await patcherArticle(cible.id, patch);
    if (!r.ok) { flash("Enregistrement impossible : " + r.erreur, true); return; }
    /* Ne pas écraser un champ en cours d'édition : seules les métadonnées
       calculées (scores) et le statut sont recopiés. */
    setSel((s) => (s && s.id === cible.id ? { ...s, scores: r.data.scores, status: r.data.status } : s));
    const apres = ref.current.sel;
    if (apres && apres.id === cible.id) syncRow({ ...apres, scores: r.data.scores, status: r.data.status });
  }, [flash, syncRow]);

  const editer = useCallback((m: Modification | null) => {
    if (!m) return;
    setSel(m.article);
    syncRow(m.article);
    pending.current = fusionnerPatch(pending.current, m.patch);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flushPersist(); }, DELAI_PERSISTANCE_MS);
  }, [flushPersist, syncRow]);

  const editerMaintenant = useCallback(async (m: Modification | null) => {
    if (!m) return;
    setSel(m.article);
    syncRow(m.article);
    const r = await patcherArticle(m.article.id, m.patch);
    if (!r.ok) { flash("Enregistrement impossible : " + r.erreur, true); return; }
    setSel((s) => (s && s.id === m.article.id ? { ...s, scores: r.data.scores, status: r.data.status } : s));
  }, [flash, syncRow]);

  /* ---------- file et sélection ---------- */
  const loadIndex = useCallback(async () => {
    try {
      const { articles } = await client.indexComplet();
      setIndex(articles);
    } catch (err) { flash((err as Error).message, true); }
  }, [flash]);

  const selectArticle = useCallback(async (id: string | null) => {
    if (!id) { setSel(null); setSelId(null); return; }
    setSelId(id);
    try { setSel(await client.article(id)); } catch { setSel(null); }
  }, []);

  const setPortee = useCallback((patch: Partial<Portee>, ouvrirPremier = false) => {
    setPorteeBase((p) => {
      const n = { ...p, ...patch };
      if (ouvrirPremier) {
        const first = filteredIndex(ref.current.index, { ...n, prefsDepts: ref.current.portee.prefsDepts, orgDe: ref.current.portee.orgDe })[0];
        if (first && first.id !== ref.current.selId) void selectArticle(first.id);
      }
      return n;
    });
  }, [selectArticle]);

  /* Entrer dans le travail depuis l'accueil : poser les filtres, basculer sur
     la relecture, ouvrir le premier article de la file ainsi obtenue. */
  const gotoFile = useCallback(async (o: { zone?: string; kind?: string; focus?: string }) => {
    const n: Omit<Portee, "prefsDepts"> = { zone: (o.zone as Portee["zone"]) || "hab", kind: o.kind || "", focus: (o.focus as Portee["focus"]) || "", dept: null, sourceFilter: "" };
    setPorteeBase(n);
    router.push("/console");
    const first = filteredIndex(ref.current.index, { ...n, prefsDepts: ref.current.portee.prefsDepts })[0] || null;
    await selectArticle(first ? first.id : null);
  }, [router, selectArticle]);

  /* Ouvre depuis l'historique, en recalant la zone du rail sur l'article. */
  const openFromHistory = useCallback(async (id: string) => {
    router.push("/console");
    await selectArticle(id);
    const z = ref.current.sel?.zoneClass as Portee["zone"] | undefined;
    if (z && z !== ref.current.portee.zone) setPorteeBase((p) => ({ ...p, zone: z, dept: null, sourceFilter: "" }));
  }, [router, selectArticle]);

  const decide = useCallback(async (status: string, verb: string, icone: string) => {
    const cible = ref.current.sel; if (!cible) return;
    await flushPersist();
    const nid = nextPending(ref.current.index, ref.current.portee, cible.id);
    const r = await changerStatut(cible.id, status, ref.current.moi.roleLabel);
    if (!r.ok) return flash(r.erreur, true);
    setIndex((idx) => ligneApresDecision(idx, r.data));
    flash(`« ${cible.title.slice(0, 32)}… » — ${verb}`, false, icone);
    await loadIndex();
    await selectArticle(nid || filteredIndex(ref.current.index, ref.current.portee)[0]?.id || null);
  }, [flash, flushPersist, loadIndex, selectArticle]);

  const publishArticle = useCallback(async (scheduledAt: string | null) => {
    const cible = ref.current.sel; if (!cible) return;
    if (writtenByMock(cible)) return flash(MOCK_PUBLISH_REFUSAL as string, true);
    if (illustrationBlocked(cible, ref.current.moi.feats)) return flash(ILLUSTRATION_REFUSAL as string, true);
    const refus = refusConformite(criteresManquants(cible, ref.current.moi.scoring, { sansIllustration: !!ref.current.moi.feats.sansIllustration }));
    if (refus) return flash(refus, true);
    if (!can(ref.current.moi.role, "publish")) return;
    await flushPersist();
    const r = await publier(cible.id, scheduledAt);
    if (!r.ok) return flash(r.erreur, true);
    setSel(r.data.article);
    setIndex((idx) => ligneApresDecision(idx, r.data.article));
    /* « (simulé) » seulement si l'envoi l'était ; l'illustration qui n'a pas pu
       partir (M3-66) ne bloque pas la parution, mais se dit. */
    const pub = (r.data.publication || {}) as { simulated?: boolean; sentAsDraft?: boolean; illustrationError?: string | null };
    const envoi = scheduledAt ? "Parution planifiée"
      : pub.simulated === true ? "Envoyé en parution (simulé)"
      : pub.sentAsDraft ? "Envoyé sur WordPress en brouillon" : "Publié sur WordPress";
    if (pub.illustrationError) flash(`${envoi}, sans illustration : ${pub.illustrationError}`, true, "Send");
    else flash(envoi, false, "Send");
    await loadIndex();
  }, [flash, flushPersist, loadIndex]);

  const regenerate = useCallback(async (alt: string | null, force: boolean) => {
    const cible = ref.current.sel; if (!cible) return;
    setModale(null);
    flash("Génération en cours…", false, "RotateCcw");
    const r = await regenerer(cible.id, alt, force);
    if (!r.ok) return flash(r.erreur, true);
    setSel(r.data);
    setIndex((idx) => ligneApresDecision(idx, r.data));
    await loadIndex();
    if (r.data._llm && r.data._llm.degraded) {
      const m = await relireMoi();
      if (m.ok) setMoi(m.data);
      flash(r.data._llm.cap ? "Version régénérée en mock — plafond de dépense LLM atteint" : "Version régénérée — LLM indisponible, mode mock", true, "RotateCcw");
    } else {
      /* Relances après hallucination (M3-55) : une phrase de plus, en avertissement si le doute reste. */
      const regen = (r.data._llm as { regen?: ChecksRegen | null } | null | undefined)?.regen;
      const relances = messageRegeneration(regen);
      flash(relances ? `Nouvelle version générée — ${relances}` : "Nouvelle version générée", !!relances && regen?.issue !== "ok");
    }
  }, [flash, loadIndex]);

  /* « Voir comme » : honoré seulement pour un administrateur, le serveur
     renvoie sinon le rôle du compte. */
  const changeRole = useCallback(async (role: string) => {
    const r = await voirComme(role);
    if (!r.ok) return flash(r.erreur, true);
    setMoi(r.data);
    router.refresh();
  }, [flash, router]);

  const ouvrirNotifications = useCallback(async () => {
    try {
      const r = await client.notifications();
      setNotifCount(r.unread);
      setModale({ kind: "notifs", liste: r.notifications });
    } catch (err) { flash((err as Error).message, true); }
  }, [flash]);

  const value = useMemo<Console>(() => ({
    index, referentiel, sel, selId, portee, moi, notifCount, modale,
    selectArticle, loadIndex, setPortee, gotoFile, openFromHistory, decide, publishArticle, regenerate, changeRole,
    setNotifCount, ouvrirModale: setModale, ouvrirNotifications, fermerModale: () => setModale(null),
    editer, editerMaintenant, flushPersist,
  }), [index, referentiel, sel, selId, portee, moi, notifCount, modale, selectArticle, loadIndex, setPortee, gotoFile, openFromHistory, decide, publishArticle, regenerate, changeRole, ouvrirNotifications, editer, editerMaintenant, flushPersist]);

  /* ---------- sondage léger : recharge l'index si un run a produit des changements ---------- */
  const version = useRef<{ generated_at: string; total: number } | null>(null);
  useEffect(() => {
    let vivant = true;
    const tick = async () => {
      try {
        const v = await client.versionIndex();
        if (!vivant) return;
        if (version.current && v.generated_at === version.current.generated_at && v.total === version.current.total) return;
        version.current = v;
        if (version.current) await loadIndex();
      } catch { /* ignore */ }
    };
    client.versionIndex().then((v) => { if (vivant) version.current = v; }).catch(() => {});
    const h = window.setInterval(tick, 30000);
    return () => { vivant = false; window.clearInterval(h); };
  }, [loadIndex]);

  /* L'article est chargé dès l'arrivée, même sur l'accueil : passer en
     relecture ne doit pas commencer par un écran vide. */
  useEffect(() => {
    /* Différé d'un tour : la sélection part d'un aller-retour serveur, pas d'un
       état à poser pendant l'effet. */
    const t = window.setTimeout(() => {
      const { index, portee, selId } = ref.current;
      if (selId !== null) return;
      const first = filteredIndex(index, portee)[0] || index[0];
      if (first) void selectArticle(first.id);
    }, 0);
    return () => window.clearTimeout(t);
  }, [selectArticle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
