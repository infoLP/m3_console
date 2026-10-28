"use client";

// La coque de la console : colonne de navigation, en-tête, modales, clavier.
// Héritée de l'ancien front HTML (supprimé) : colonne, en-tête et gestionnaires
// globaux du clavier. Une vue = une URL ; la file et l'article ouvert vivent
// dans le magasin, qui survit aux navigations.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Icone } from "@/composants/Icone";
import { ToastProvider } from "@/composants/Toast";
import { ecrirePrefs, usePrefs } from "@/composants/prefs";
import { can } from "@shared/model.js";
import { STATUSES } from "@shared/model.js";
import { seDeconnecter } from "@/seConnecter/seConnecter.action";
import type { Moi } from "@/seConnecter/seConnecter.regles";
import { HREF_CONCURRENTS, lienConcurrentsConsole } from "@/gererConcurrents/gererConcurrents.regles";
import { kpisEntete, voisin, type Ligne, type SourceRef } from "@/relireArticles/relireArticles.regles";
import { normKey, raccourcis, saisieEnCours } from "@/reglerPreferences/reglerPreferences.regles";
import { ConsoleProvider, useConsole } from "./store";
import { ModalePreferences } from "./modales/ModalePreferences";
import { ModaleDemande } from "./modales/ModaleDemande";
import { ModaleNotifications } from "./modales/ModaleNotifications";
import { ModaleRegenerer } from "./modales/ModaleRegenerer";
import { ModaleRaccourcis } from "./modales/ModaleRaccourcis";

const STATUTS = STATUSES as Record<string, { label: string; color: string }>;

export function CoqueConsole({ moi, index, sources, nonLues, children }: { moi: Moi; index: Ligne[]; sources: SourceRef[]; nonLues: number; children: ReactNode }) {
  return (
    <ToastProvider>
      <ConsoleProvider moiInitial={moi} indexInitial={index} sourcesInitiales={sources} notifsInitiales={nonLues}>
        <Coque>{children}</Coque>
      </ConsoleProvider>
    </ToastProvider>
  );
}

const COIFFE: Record<string, [string, string | null]> = {
  "/console/accueil": ["Accueil", "état de la veille"],
  "/console": ["Console de rédaction", "bonne relecture"],
  "/console/historique": ["Historique", null],
  "/console/suivi": ["Suivi", null],
};

function Coque({ children }: { children: ReactNode }) {
  const c = useConsole();
  const pathname = usePathname();
  const prefs = usePrefs();
  const folded = !!prefs.navFolded;
  const u = c.moi.user;

  const navrow = (icon: string, label: string, onClick: () => void, extra?: ReactNode, nom: string = label) => (
    <button className="cr-navrow" type="button" onClick={onClick} title={label} aria-label={nom}><Icone nom={icon} size={15} /><span className="cr-navrow-l">{label}</span>{extra}</button>
  );
  /* aria-current dit la vue active à un lecteur d'écran ; aria-label garde le
     nom quand la colonne repliée masque le libellé. */
  const vue = (href: string, icon: string, label: string) => (
    <Link href={href} className={`cr-navrow${pathname === href ? " on" : ""}`} title={label} aria-label={label} aria-current={pathname === href ? "page" : undefined}><Icone nom={icon} size={15} /><span className="cr-navrow-l">{label}</span></Link>
  );

  /* L'état dégradé du LLM : affiché seulement s'il y a quelque chose à dire. */
  const last = c.moi.llmLastRun;
  const capped = !!(last && last.cap);
  const degraded = capped || (last && last.fallbacks > 0 && c.moi.llmProvider !== "mock");
  const llm = capped ? "Plafond de dépense LLM atteint" : "LLM mock — OpenRouter indisponible";

  const k = kpisEntete(c.index);
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const [titre, suite] = COIFFE[pathname] || ["Console de rédaction", null];

  return (
    <>
      <RemonteeClavier />
      <div className={`cr-app${folded ? " folded" : ""}`}>
        <nav className="cr-side">
          <div className="cr-side-id">
            <span className="cr-side-mark">M3<span>prototype</span></span>
            <button className="cr-fold" type="button" onClick={() => ecrirePrefs({ navFolded: !folded })} aria-expanded={!folded} title={folded ? "Déplier la navigation" : "Replier la navigation"} aria-label={folded ? "Déplier la navigation" : "Replier la navigation"}><Icone nom="AlignLeft" size={15} /></button>
          </div>
          <div className="cr-side-g">
            {c.moi.canSeeHome && vue("/console/accueil", "Gauge", "Accueil")}
            {vue("/console", "FileText", "Relecture")}
            {vue("/console/historique", "Clock", "Historique")}
            {can(c.moi.role, "view_stats") && vue("/console/suivi", "BarChart", "Suivi")}
          </div>
          <div className="cr-side-g">
            {navrow("Bell", "Notifications", () => { void c.ouvrirNotifications(); }, c.notifCount ? <span className="b">{c.notifCount}</span> : null, c.notifCount ? `Notifications (${c.notifCount} non lues)` : "Notifications")}
            {c.moi.feats.demandeSource && navrow("Plus", "Demander une source", () => c.ouvrirModale({ kind: "ticket" }))}
            {navrow("Settings", "Préférences", () => c.ouvrirModale({ kind: "prefs" }))}
            {can(c.moi.role, "backoffice") && <Link className="cr-navrow" href="/admin" title="Back-office" aria-label="Back-office"><Icone nom="Sliders" size={15} /><span className="cr-navrow-l">Back-office</span></Link>}
            {/* M3-120 : le superutilisateur n'a du back-office que Sources → Concurrents. */}
            {lienConcurrentsConsole(c.moi.role) && <Link className="cr-navrow" href={HREF_CONCURRENTS} title="Concurrents" aria-label="Concurrents"><Icone nom="Globe" size={15} /><span className="cr-navrow-l">Concurrents</span></Link>}
          </div>
          <div className="cr-side-foot">
            {degraded && <div className="cr-llm-warn" title={llm}><Icone nom="Sparkles" size={13} /><span className="cr-navrow-l">{llm}</span></div>}
            <div className="cr-side-me">
              {c.moi.canSwitchRole ? (
                <>
                  <span className="cr-who" title={u?.login || ""}>{u?.name || ""}</span>
                  <label className="cr-as" htmlFor="cr-role">voir comme</label>
                  <select className="cr-role" id="cr-role" value={c.moi.role} onChange={(e) => c.changeRole(e.target.value)}>
                    {c.moi.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </>
              ) : (
                <span className="cr-who" title={u?.login || ""}>{u?.name || ""}<span className="cr-as"> · {c.moi.roleLabel || ""}</span></span>
              )}
            </div>
            <form action={seDeconnecter}><button className="cr-navrow" type="submit" title="Se déconnecter" aria-label="Se déconnecter"><Icone nom="LogOut" size={15} /><span className="cr-navrow-l">Se déconnecter</span></button></form>
          </div>
        </nav>
        <div className="cr-shell">
          <header className="cr-top">
            <div className="cr-top-id">
              <div className="cr-title">{titre}</div>
              <div className="cr-date">{today}{suite ? ` · ${suite}` : ""}</div>
            </div>
            <div className="cr-counts">
              <div className="cr-kpi"><div className="n">{k.drafts}</div><div className="l"><Icone nom="FileText" size={12} />brouillons du jour</div></div>
              <div className="cr-kpi"><div className="n">{k.pending}</div><div className="l"><Icone nom="AlignLeft" size={12} />à traiter</div></div>
              <div className="cr-kpi"><div className="n n--stop">{k.signaled}</div><div className="l"><Icone nom="XCircle" size={12} />signalés</div></div>
              <div className="cr-kpi"><div className="n n--go">{k.publishedToday}</div><div className="l"><Icone nom="Send" size={12} />publiés aujourd&apos;hui</div></div>
            </div>
            <div className="cr-legend">{Object.entries(STATUTS).map(([key, v]) => <span key={key}><i className={`cr-dot cr-dot--${key}`}></i>{v.label}</span>)}</div>
          </header>
          {children}
        </div>
      </div>
      {c.modale?.kind === "prefs" && <ModalePreferences />}
      {c.modale?.kind === "ticket" && <ModaleDemande />}
      {c.modale?.kind === "notifs" && <ModaleNotifications liste={c.modale.liste} />}
      {c.modale?.kind === "reai" && <ModaleRegenerer />}
      {c.modale?.kind === "raccourcis" && <ModaleRaccourcis />}
    </>
  );
}

/* ====================== raccourcis clavier ======================
   Deux précautions tiennent tout : la console est éditable partout, donc une
   touche n'agit jamais pendant une saisie ; et rien n'agit derrière un dialogue
   modal (modale, tiroir). Les deux actions irréversibles (classer sans diffusion,
   envoyer en parution) ne s'exécutent pas à la frappe : la touche ouvre la
   ConfirmationSurPlace du bouton de la barre de décision (M3-107, B4). */
function RemonteeClavier() {
  const c = useConsole();
  const pathname = usePathname();
  const prefs = usePrefs();
  /* Toujours la dernière valeur pour le gestionnaire, qui n'est posé qu'une fois ;
     mise à jour après chaque rendu, jamais pendant. */
  const ref = useRef({ c, pathname, prefs });
  useEffect(() => { ref.current = { c, pathname, prefs }; });

  useEffect(() => {
    /* Ouvre la confirmation du bouton de la barre, sur place. Le déclencheur est
       le seul bouton direct de l'enveloppe : une confirmation déjà ouverte (dont
       le premier bouton serait « Confirmer ») n'est jamais cliquée par une frappe. */
    const demanderConfirmation = (enveloppe: string) => {
      document.querySelector<HTMLButtonElement>(`#${enveloppe} > button:not(:disabled)`)?.click();
    };
    const onKey = (e: KeyboardEvent) => {
      const { c, pathname, prefs } = ref.current;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (c.modale) return;                          // une modale ouverte a la main
      /* Un tiroir ouvert est un dialogue modal comme une modale : ses touches
         (Échap, Tab) sont les siennes ; rien ne doit agir derrière lui. */
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      /* Une confirmation sur place est ouverte : Entrée, Échap et Tab lui appartiennent. */
      if (document.querySelector(".ui-confirmation")) return;
      if (saisieEnCours(e.target)) { if (e.key === "Escape") (e.target as HTMLElement).blur(); return; }
      if (e.key === "?") { e.preventDefault(); c.ouvrirModale({ kind: "raccourcis" }); return; }
      if (pathname !== "/console") return;           // tout le reste ne vaut que sur la relecture

      const { actions } = raccourcis(c.moi.keys, prefs);
      const k = normKey(e.key) as string;
      const a = actions.find((x) => x.actif && (x.touche === k || (x.alt && x.alt === e.key)));
      if (!a) return;
      const PERMET: Record<string, () => boolean> = {
        pub: () => !!c.sel && can(c.moi.role, "publish"), arch: () => !!c.sel, reai: () => !!c.sel, requeue: () => !!c.sel,
      };
      if (PERMET[a.id] && !PERMET[a.id]()) return;
      /* Les actions à confirmer : enveloppe de leur bouton dans la barre de décision. */
      const CONFIRMEE: Record<string, string> = { pub: "conf-pub", arch: "conf-arch" };
      const EXECUTE: Record<string, () => void> = {
        next: () => { const id = voisin(c.index, c.portee, c.selId, 1); if (id) void c.selectArticle(id); },
        prev: () => { const id = voisin(c.index, c.portee, c.selId, -1); if (id) void c.selectArticle(id); },
        reai: () => c.ouvrirModale({ kind: "reai" }),
        requeue: () => { void c.decide("a_revoir", "remis dans la file", "RotateCcw"); },
        pub: () => { void c.publishArticle((document.getElementById("sched") as HTMLInputElement | null)?.value ? new Date((document.getElementById("sched") as HTMLInputElement).value).toISOString() : null); },
        arch: () => { void c.decide("archive", "classé sans diffusion", "Archive"); },
      };
      e.preventDefault();
      if (a.arme && CONFIRMEE[a.id]) { demanderConfirmation(CONFIRMEE[a.id]); return; }
      EXECUTE[a.id]();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
