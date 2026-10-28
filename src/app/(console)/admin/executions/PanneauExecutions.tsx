"use client";

// Onglet Dernier run, porté de runsView(). Les boutons récolte et génération
// déposent une demande (phase 1) ; on suit son état par GET /api/runs — une
// lecture SONDÉE, donc un fetch sur la route conservée, pas une action —
// jusqu'à ce qu'elle soit close, puis on affiche le même résumé qu'avant.
// M3-109 : historique en frise d'étapes (B1), destructif confirmé sur place (B4).
// M3-112 : sections repliables, choix mémorisé dans les préférences de poste.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Icone } from "@/composants/Icone";
import { ConfirmationSurPlace } from "@/composants/primitives";
import { useFlash } from "@/composants/Toast";
import { ecrirePrefs, lirePrefs, usePrefs } from "@/composants/prefs";
import {
  duree, dureeDemande, etatDemande, frise, hm, LIBELLE_DEMANDE, messageFin, RAISON_SAUT, resumeDemande, texteDerniereChaine,
  type Demande, type Executions,
} from "@/lancerExecutions/lancerExecutions.regles";
import { demanderGeneration, demanderRecolte, purgerArticles, recalculerScores } from "@/lancerExecutions/lancerExecutions.action";

/* Ouvertes par défaut ; le choix de l'utilisateur est rangé dans m3:prefs
   (clé runsSections), qui gère déjà l'absence de stockage. */
const SECTIONS_OUVERTES: Record<string, boolean> = { demandes: false, recuperation: true, historique: false };

function Section({ id, titre, className, children }: { id: string; titre: string; className?: string; children: ReactNode }) {
  const choix = usePrefs().runsSections as Record<string, boolean> | undefined;
  const ouvert = choix?.[id] ?? SECTIONS_OUVERTES[id];
  return (
    <details className={className ? `bo-section ${className}` : "bo-section"} open={ouvert}
      onToggle={(e) => {
        const o = e.currentTarget.open;
        /* toggle part aussi quand React pose `open` : ne rien écrire dans ce cas. */
        if (o !== ouvert) ecrirePrefs({ runsSections: { ...(lirePrefs().runsSections as Record<string, boolean> | undefined), [id]: o } });
      }}>
      <summary><span className="bo-fold-ic" aria-hidden="true">{ouvert ? "▾" : "▸"}</span><h3>{titre}</h3></summary>
      {children}
    </details>
  );
}

const dateHeure = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR"); };

export function PanneauExecutions({ initial }: { initial: Executions }) {
  const flash = useFlash();
  const router = useRouter();
  /* `live` : l'état relu pendant un sondage, qui prime sur celui de la page
     jusqu'à ce qu'elle se rafraîchisse (router.refresh → nouvel `initial`). */
  const [live, setLive] = useState<Executions | null>(null);
  const [initialVu, setInitialVu] = useState(initial);
  if (initial !== initialVu) { setInitialVu(initial); setLive(null); }
  const r = live ?? initial;
  const setR = setLive;
  const [enCours, lancer] = useTransition();
  /* T14 : décochée par défaut, un contenu source déjà généré ne l'est plus. */
  const [regen, setRegen] = useState(false);
  const vivant = useRef(true);
  useEffect(() => () => { vivant.current = false; }, []);

  /* Relit /api/runs toutes les 3 s jusqu'à ce que la demande soit close (au plus
     30 min). Chaque relecture rafraîchit le bloc : on voit passer « en attente »
     puis « en cours » sans rien faire. */
  async function attendre(id: number, everyMs = 3000, maxMs = 30 * 60000): Promise<Demande | null> {
    const until = Date.now() + maxMs;
    while (Date.now() < until && vivant.current) {
      await new Promise((ok) => setTimeout(ok, everyMs));
      try {
        const res = await fetch("/api/runs", { headers: { Accept: "application/json" } });
        if (!res.ok) continue;
        const data = (await res.json()) as Executions;
        setR(data);
        const j = (data.jobs || []).find((x) => x.id === id);
        if (j && j.finishedAt) return j;
      } catch { /* réseau : on réessaie */ }
    }
    return null;
  }

  const demander = (kind: "harvest" | "generate") => lancer(async () => {
    const res = kind === "harvest" ? await demanderRecolte() : await demanderGeneration();
    if (!res.ok) return flash(res.erreur, true);
    const nom = kind === "harvest" ? "récupération" : "génération";
    flash(res.data.job.duplicate ? `Une ${nom} est déjà demandée — en attente du worker…` : `${nom[0].toUpperCase() + nom.slice(1)} demandée au worker…`);
    const fin = await attendre(res.data.job.id);
    const m = messageFin(fin, kind);
    flash(m.texte, m.erreur);
    router.refresh();
  });
  /* Confirmés sur place : un échec est rejeté, et ConfirmationSurPlace l'affiche
     à côté du bouton, avec la possibilité de réessayer. */
  async function rescorer() {
    const res = await recalculerScores();
    if (!res.ok) throw new Error(res.erreur);
    flash(res.data.changed ? `${res.data.changed} article(s) sur ${res.data.total} rescorés` : `${res.data.total} articles, aucun score à reprendre`);
    router.refresh();
  }
  async function purger() {
    const res = await purgerArticles(regen);
    if (!res.ok) throw new Error(res.erreur);
    flash(`${res.data.removed} article(s) purgé(s), consultables dans l'Historique de la console${res.data.rearmed ? " — dernière récupération réarmée, relancez une génération" : ""}`);
    router.refresh();
  }

  const sc = r.schedule;
  const h = r.harvest;
  const skipped = h?.skipped || [];
  const jobs = r.jobs || [];
  const passages = frise(r.runs || []);

  return (
    <div>
      {sc && (
        <div className="bo-card"><h3>Planification</h3>
          <p className="bo-note">{sc.enabled
            ? <><span className="bo-pill on">activée</span> récolte puis génération à {sc.times.join(", ")} (heure de Paris) · prochaine : <b>{hm(sc.next)}</b></>
            : <><span className="bo-pill off">désactivée</span> rien ne se lance seul — à activer dans Paramètres (« Planification »).</>}
            {sc.error && <><br /><span className="text-stop">Horaires illisibles : {sc.error}</span></>}
            {sc.running && <><br />En cours : chaîne de {hm(sc.running)}.</>}</p>
          <p className="bo-note">Dernière chaîne : {texteDerniereChaine(sc)}{sc.lastSkipped ? ` · créneau de ${hm(sc.lastSkipped)} non rattrapé (serveur arrêté trop longtemps)` : ""}</p>
          <p className="bo-note">Les articles programmés passent en « publié » à leur heure, que la planification soit activée ou non.</p>
        </div>
      )}
      {jobs.length > 0 && (
        <div className="bo-card"><Section id="demandes" titre="Demandes au worker">
          <p className="bo-note">« Lancer une récupération » et « Lancer une génération » déposent une demande ; c&apos;est le conteneur <code>m3-worker</code> qui l&apos;exécute, sous le même verrou que la planification. Une demande qui reste « en attente » signifie que le worker ne tourne pas.</p>
          <div className="bo-scroll"><table className="bo-table"><thead><tr><th>Demande</th><th>Par</th><th>Demandée</th><th>État</th><th>Durée</th><th>Résultat</th></tr></thead><tbody>
            {jobs.map((j) => { const e = etatDemande(j); return (
              <tr key={j.id}><td>{LIBELLE_DEMANDE[j.kind] || j.kind}</td><td>{j.requestedBy || "—"}</td><td className="bo-note">{j.requestedAt ? new Date(j.requestedAt).toLocaleString("fr-FR") : "—"}</td><td><span className={`bo-pill ${e.pill}`}>{e.libelle}</span></td><td className="bo-note">{duree(dureeDemande(j))}</td><td className="bo-note">{resumeDemande(j)}</td></tr>
            ); })}
          </tbody></table></div></Section></div>
      )}
      <div className="bo-card"><Section id="recuperation" titre="Dernière récupération">
        {h ? (
          <>
            <p className="bo-note">{h.date}{h.scheduled ? " (planifiée)" : ""} — {h.stats.items} contenus nouveaux{h.stats.carried ? ` + ${h.stats.carried} reportés de la précédente` : ""} · {h.stats.ok}/{h.stats.sources} sources interrogées OK · {h.stats.failures} échecs{skipped.length ? ` · ${skipped.length} sautées` : ""}</p>
            <div className="bo-scroll"><table className="bo-table"><thead><tr><th>Source</th><th>État</th><th>Items / erreur</th></tr></thead><tbody>
              {(h.sources || []).map((s, i) => <tr key={i}><td>{s.name}</td><td>{s.ok ? <span className="bo-pill on">OK</span> : <span className="bo-pill off">échec</span>}</td><td className="bo-note">{s.ok ? `${s.count || 0} items` : s.error || ""}</td></tr>)}
              {skipped.map((s, i) => <tr key={`s${i}`}><td>{s.name}</td><td><span className="bo-pill off">{RAISON_SAUT[s.reason || ""] || "sautée"}</span></td><td className="bo-note">{s.detail || ""}</td></tr>)}
            </tbody></table></div>
          </>
        ) : <p className="bo-note">Aucune récupération lancée — utilisez « Lancer une récupération » ci-dessous.</p>}
        </Section>
        <div className="bo-actions mt-3.5">
          <button className="bo-btn primary" type="button" onClick={() => demander("harvest")} disabled={enCours}><Icone nom="RotateCcw" size={13} />Lancer une récupération</button>
          <button className="bo-btn" type="button" onClick={() => demander("generate")} disabled={enCours}><Icone nom="Sparkles" size={13} />Lancer une génération</button>
          <ConfirmationSurPlace libelle="Recalculer les scores" icone="Check" varianteDeclencheur="secondaire" taille="petite" desactive={enCours}
            consequence="Les scores de tous les articles déjà générés seront recalculés avec les seuils actuels des Paramètres. Seuls les scores sont réécrits : textes et statuts ne changent pas."
            libelleConfirmer="Recalculer" libelleEnCours="Recalcul…" onConfirm={rescorer} />
          <label className="bo-check"><input type="checkbox" id="purge-regen" name="allowRegen" checked={regen} disabled={enCours} onChange={(e) => setRegen(e.target.checked)} /> Autoriser la régénération</label>
          <ConfirmationSurPlace libelle="Purger les articles" icone="Trash" taille="petite" desactive={enCours}
            consequence={`Tous les articles sortiront de la file de relecture. Ils restent consultables dans l'Historique de la console, sous « Purgés », avec la date et l'auteur de la purge. Les sources sont gardées et la dernière récupération réarmée. ${regen ? "Régénération autorisée : une nouvelle génération pourra refaire ces articles." : "Un contenu source déjà généré ne sera pas régénéré, même après réarmement (cochez « Autoriser la régénération » pour le permettre)."}`}
            libelleConfirmer="Purger" libelleEnCours="Purge…" onConfirm={purger} />
        </div>
        <p className="bo-note mt-2">« Recalculer les scores » applique les seuils actuels de l&apos;onglet Paramètres aux articles déjà générés — à lancer après les avoir changés. Seuls les scores sont réécrits.</p>
        <p className="bo-note mt-2">« Purger les articles » retire tous les articles de la file de relecture. Ils ne sont pas supprimés : l&apos;Historique de la console les garde, sous « Purgés », avec la date et l&apos;auteur de la purge. Le référentiel de sources et la dernière récupération sont conservés (celle-ci est réarmée). Par défaut, un contenu source déjà généré n&apos;est plus régénéré, même après réarmement ; cocher « Autoriser la régénération » permet de le régénérer à la prochaine génération.</p>
        <Section id="historique" titre="Historique" className="mt-5">
        {passages.length ? (
          <ol className="m-0 flex list-none flex-col p-0">
            {passages.map((p) => (
              <li key={p.cle} className="border-x-0 border-t-0 border-b border-dashed border-line py-2.5">
                <div className="flex flex-wrap items-baseline gap-2.5 text-base">
                  <span className="bo-note">{dateHeure(p.debut)}</span>
                  <b>{p.routine ? "Routine" : p.etapes[0].libelle}</b>
                  {p.dureeMs != null && <span className="bo-note">{duree(p.dureeMs)} au total</span>}
                </div>
                <ol className="mt-1 flex flex-wrap items-center gap-1.5" aria-label="Étapes">
                  {p.etapes.map((e, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span aria-hidden="true" className="text-ink-3">→</span>}
                      <span className="flex flex-wrap items-baseline gap-1.5 rounded-m3-sm bg-surface-2 px-2 py-0.5 text-xs">
                        <b>{e.libelle}</b>
                        {e.kind !== "schedule" && <span className="text-ink-2">{e.dureeMs != null ? duree(e.dureeMs) : "durée non mesurée"}</span>}
                        {e.resume && <span className="text-ink-2">· {e.resume}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        ) : <p className="bo-note">Aucune exécution enregistrée.</p>}
        </Section>
      </div>
    </div>
  );
}
