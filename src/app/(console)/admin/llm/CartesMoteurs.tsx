"use client";

// Onglet LLM — un moteur par section.
// La clé d'API ne descend JAMAIS jusqu'ici : le serveur n'envoie que `hasKey`
// et une empreinte. Le champ de saisie n'apparaît qu'après « Remplacer ».
// Chaque carte ouverte édite un brouillon local ; toute action qui a besoin de
// l'état enregistré (activer, récupérer, tester) enregistre d'abord.

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Icone } from "@/composants/Icone";
import { ConfirmationSurPlace } from "@/composants/primitives";
import { useFlash } from "@/composants/Toast";
import { AVERTISSEMENT_ROUTEUR, bandeau, brouillonDe, estRouteur, etatSecours, etatTests, modeleRelecture, modeleSecours, modelesProposes, patchDe, pluriel, testEnCours, verdictDe, type Brouillon, type Moteur, type Moteurs } from "@/gererMoteursIA/gererMoteursIA.regles";
import { consequenceRetraitCle, consequenceRetraitSecours, consequenceSuppressionMoteur } from "./CartesMoteurs.consequences";
import { activerMoteur, ajouterMoteur, definirRelecture, definirSecours, enregistrerMoteur, recupererModeles, retirerCle, supprimerMoteur, testerMoteur } from "@/gererMoteursIA/gererMoteursIA.action";

/* Un échec renvoyé par retour (et non levé) doit faire rejeter onConfirm : l'erreur s'affiche sur place. */
const exiger = (r: { ok: boolean; erreur?: string }) => { if (!r.ok) throw new Error(r.erreur); };

const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("fr-FR") : null);

/* Options d'un <select> de modèles : seulement les disponibles (T5), plus le
   modèle déjà choisi, marqué s'il a échoué au dernier test. */
const optionModele = (x: ReturnType<typeof modelesProposes>["options"][number]) => (
  <option key={x.value} value={x.value} title={x.ko ? `Échec au dernier test : ${x.ko}` : x.routeur ? AVERTISSEMENT_ROUTEUR : undefined}>{x.value}{x.horsListe ? " — hors liste blanche" : ""}{x.ko ? ` — ✕ ${x.ko.split(" — ")[0]}` : ""}</option>
);
/* Routeurs et alias dans un groupe à part : modèle variable, à réserver aux essais. */
const optionsModeles = (o: ReturnType<typeof modelesProposes>["options"]) => {
  const fixes = o.filter((x) => !x.routeur), routeurs = o.filter((x) => x.routeur);
  return <>{fixes.map(optionModele)}{routeurs.length ? <optgroup label="Routeurs et alias — modèle variable">{routeurs.map(optionModele)}</optgroup> : null}</>;
};

/* Ligne d'état du test des modèles, sous le catalogue. */
function EtatTest({ p }: { p: Moteur }) {
  const e = etatTests(p);
  if (e.phase === "aucun") return null;
  if (e.phase === "attente") return <div className="llm-note"><Icone nom="RotateCcw" size={12} /> Test des modèles demandé — en attente du worker (une récolte ou une génération en cours passe avant).</div>;
  if (e.phase === "en_cours") return <div className="llm-note"><Icone nom="Gauge" size={12} /> Test des modèles en cours… {e.faits}/{e.total}. La liste des modèles disponibles s&apos;affichera à la fin.</div>;
  const quand = date(e.finishedAt);
  return (
    <div className={`llm-note${e.stopped || e.interrompu ? " warn" : ""}`}>
      {e.interrompu
        ? <>Test des modèles interrompu (worker redémarré ?) après {e.faits}/{e.total}. Relancer « Récupérer la liste ».</>
        : <>Dernier test : {pluriel(e.faits - e.ko, "modèle")} répond{e.faits - e.ko > 1 ? "ent" : ""}, {pluriel(e.ko, "échec")} (retiré{e.ko > 1 ? "s" : ""} de la liste){quand ? ` · ${quand}` : ""}.</>}
      {e.stopped && <> Arrêté au plafond de dépense ({e.stopped}) : {pluriel(e.total - e.faits, "modèle")} non testé{e.total - e.faits > 1 ? "s" : ""}, laissé{e.total - e.faits > 1 ? "s" : ""} sélectionnable{e.total - e.faits > 1 ? "s" : ""}.</>}
    </div>
  );
}

export function CartesMoteurs({ moteurs }: { moteurs: Moteurs }) {
  const flash = useFlash();
  const router = useRouter();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [brouillons, setBrouillons] = useState<Record<string, Brouillon>>({});
  const [cleEnEdition, setCleEnEdition] = useState<Set<string>>(new Set());
  /* Modèle choisi pour le secours ou la relecture, avant validation : « secours:<id> », « relecture:<id> ». */
  const [choixRoles, setChoixRoles] = useState<Record<string, string>>({});
  const [enCours, lancer] = useTransition();

  /* Test des modèles en cours chez le worker : on relit l'état toutes les 3 s
     pour faire avancer la progression et griser au fil de l'eau. */
  const sonder = moteurs.providers.some(testEnCours);
  useEffect(() => {
    if (!sonder) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [sonder, router]);

  const brouillon = (p: Moteur): Brouillon => brouillons[p.id] || brouillonDe(p);
  const modifier = (p: Moteur, patch: Partial<Brouillon>) => setBrouillons((b) => ({ ...b, [p.id]: { ...brouillon(p), ...patch } }));
  const apresEnregistrement = (id: string) => {
    setBrouillons((b) => { const n = { ...b }; delete n[id]; return n; });
    setCleEnEdition((s) => { const n = new Set(s); n.delete(id); return n; });
    router.refresh();
  };
  const basculer = (id: string) => setOuvert((o) => (o === id ? null : id));

  const enregistrer = (p: Moteur) => lancer(async () => {
    const r = await enregistrerMoteur(p.id, patchDe(brouillon(p)));
    if (!r.ok) return flash(r.erreur, true);
    apresEnregistrement(p.id); flash("Moteur enregistré");
  });
  const activer = (p: Moteur) => lancer(async () => {
    const r = await activerMoteur(p.id, patchDe(brouillon(p)));
    if (!r.ok) return flash(r.erreur, true);
    apresEnregistrement(p.id); flash("Moteur actif changé");
  });
  const recuperer = (p: Moteur) => lancer(async () => {
    const r = await recupererModeles(p.id, patchDe(brouillon(p)));
    if (!r.ok) return flash(r.erreur, true);
    apresEnregistrement(p.id);
    const t = r.data.test;
    if ("erreur" in t) return flash(`${r.data.count} modèles récupérés — test impossible : ${t.erreur}`, true);
    flash(`${r.data.count} modèles récupérés — ${t.deja ? "test déjà demandé" : `test de ${pluriel(t.total, "modèle")} lancé`}`);
  });
  const tester = (p: Moteur) => lancer(async () => {
    const r = await testerMoteur(p.id, patchDe(brouillon(p)));
    if (!r.ok) return flash(r.erreur, true);
    apresEnregistrement(p.id);
    flash(r.data.ok ? `Connexion OK (${r.data.ms} ms, ${r.data.model})` : `Échec : ${r.data.error}`, !r.data.ok);
  });
  const retirer = async (p: Moteur) => {
    exiger(await retirerCle(p.id));
    router.refresh(); flash("Clé retirée");
  };
  const supprimer = async (p: Moteur) => {
    exiger(await supprimerMoteur(p.id));
    router.refresh(); flash("Moteur supprimé");
  };
  const retirerSecours = async (p: Moteur) => {
    exiger(await definirSecours(null, ""));
    oublierChoix(`secours:${p.id}`);
    router.refresh(); flash("Plus de moteur de secours : un échec repasse directement en mock");
  };
  const oublierChoix = (cle: string) => setChoixRoles((c) => { const n = { ...c }; delete n[cle]; return n; });
  /* Moteur de secours (M3-88) : moteur + modèle, deux réglages posés d’ici ou de l’onglet Paramètres.
     null = retirer le secours. */
  const secourir = (p: Moteur, modele: string | null) => lancer(async () => {
    const r = await definirSecours(modele === null ? null : p.id, modele || "");
    if (!r.ok) return flash(r.erreur, true);
    oublierChoix(`secours:${p.id}`);
    router.refresh(); flash(modele !== null ? `« ${p.label} » (${modele}) prend le relais si le moteur actif échoue` : "Plus de moteur de secours : un échec repasse directement en mock");
  });
  /* Moteur de relecture (M3-89) : moteur + modèle. L'activer se fait dans les Paramètres. */
  const relire = (p: Moteur, modele: string) => lancer(async () => {
    const r = await definirRelecture(p.id, modele);
    if (!r.ok) return flash(r.erreur, true);
    oublierChoix(`relecture:${p.id}`);
    router.refresh(); flash(`Les articles seront relus par « ${p.label} » (${modele})`);
  });
  const ajouter = () => lancer(async () => {
    const r = await ajouterMoteur();
    if (!r.ok) return flash(r.erreur, true);
    setOuvert(r.data.id); router.refresh();
  });

  const b = bandeau(moteurs);
  return (
    <div className="bo-card">
      <div className="bo-card-h"><h3>Moteurs LLM</h3>
        <button className="bo-btn" type="button" onClick={ajouter} disabled={enCours}><Icone nom="Plus" size={13} />Ajouter un moteur</button></div>
      {b.kind === "hors_liste" && <div className="llm-state warn"><Icone nom="Shield" size={14} /> Le modèle <code>{b.model}</code> de <b>{b.label}</b> n&apos;est pas sur la liste blanche : chaque appel est refusé avant envoi, et la génération retombe sur le <b>mock déterministe</b>. Choisir un modèle autorisé.</div>}
      {b.kind === "ok" && <div className="llm-state ok"><Icone nom="Check" size={14} /> Génération par <b>{b.label}</b> — modèle <code>{b.model}</code></div>}
      {b.kind === "mock" && <div className="llm-state warn"><Icone nom="Sparkles" size={14} /> Aucun moteur utilisable : la génération tourne sur le <b>mock déterministe</b>. {b.conseil} pour produire de vrais articles.</div>}
      <p className="bo-note">La clé d&apos;API est chiffrée en base et n&apos;est <b>jamais</b> renvoyée au navigateur — seule son empreinte est affichée. « Tester la connexion » émet un vrai appel côté serveur et n&apos;en garde que le verdict : c&apos;est le moyen de valider une clé sans jamais l&apos;exposer.</p>
      <div className="llm-list">
        {moteurs.providers.map((p) => {
          const open = ouvert === p.id;
          const kindLabel = (moteurs.kinds || {})[p.kind] || p.kind;
          const sec = etatSecours(p, moteurs);
          const tete = (
            <button className="llm-head" type="button" onClick={() => basculer(p.id)}>
              <Icone nom={open ? "AlignLeft" : "Plus"} size={13} />
              <b>{p.label}</b>
              <span className="llm-kind">{kindLabel}</span>
              {p.active ? <span className="llm-badge on">actif</span> : p.enabled ? <span className="llm-badge">activable</span> : <span className="llm-badge off">désactivé</span>}
              {!p.hasKey && <span className="llm-badge off">sans clé</span>}
              {moteurs.relectureId === p.id && <span className="llm-badge" title={`Relit chaque article généré avec ${modeleRelecture(p, moteurs)} (réglage « Moteur de relecture » des Paramètres)`}>relecture</span>}
              {sec && <span className={`llm-badge${sec.ok ? "" : " off"}`} title={sec.motif ? `Secours inopérant : ${sec.motif}` : `Appelé avec ${modeleSecours(p, moteurs)} si le moteur actif échoue`}>secours{sec.ok ? "" : " inopérant"}</span>}
            </button>
          );
          if (!open) return <div key={p.id} className="llm-card">{tete}</div>;
          const d = brouillon(p);
          const m = modelesProposes(p, moteurs.allowedModels, d.defaultModel);
          const fetched = date(p.modelsFetchedAt);
          const editionCle = cleEnEdition.has(p.id);
          return (
            <div key={p.id} className="llm-card open">{tete}
              <div className="llm-body">
                <div className="llm-field"><label htmlFor={`llm-${p.id}-nom`}>Nom</label><input id={`llm-${p.id}-nom`} className="bo-in" value={d.label} onChange={(e) => modifier(p, { label: e.target.value })} /></div>
                <div className="llm-field"><label htmlFor={`llm-${p.id}-cle`}>Clé d&apos;API</label>
                  {!moteurs.secretsAvailable ? (
                    <div className="llm-warn"><Icone nom="Shield" size={13} /> Aucune clé ne peut être enregistrée : la variable <code>M3_SECRET_KEY</code> n&apos;est pas définie sur ce serveur. Générer un secret (<code>openssl rand -hex 32</code>) et le déclarer au même titre que le mot de passe PostgreSQL.</div>
                  ) : editionCle ? (
                    <>
                      <input id={`llm-${p.id}-cle`} className="bo-in mono" type="password" autoComplete="new-password" placeholder="Coller la clé d'API…" value={d.apiKey} onChange={(e) => modifier(p, { apiKey: e.target.value })} />
                      <button className="bo-btn" type="button" onClick={() => { modifier(p, { apiKey: "" }); setCleEnEdition((s) => { const n = new Set(s); n.delete(p.id); return n; }); }}>Annuler</button>
                    </>
                  ) : (
                    <>
                      <span className="llm-hint">{p.hasKey ? (p.keyHint || "clé enregistrée") : "aucune clé"}</span>
                      <button className="bo-btn" type="button" onClick={() => setCleEnEdition((s) => new Set(s).add(p.id))}><Icone nom="Pencil" size={13} />{p.hasKey ? "Remplacer" : "Renseigner"}</button>
                      {p.hasKey && <ConfirmationSurPlace libelle="Retirer" icone="Trash" taille="petite" desactive={enCours}
                        consequence={consequenceRetraitCle(p.label)} libelleConfirmer="Retirer la clé" onConfirm={() => retirer(p)} />}
                    </>
                  )}
                </div>
                <div className="llm-field"><label htmlFor={`llm-${p.id}-url`}>URL de base</label><input id={`llm-${p.id}-url`} className="bo-in mono" value={d.baseUrl} onChange={(e) => modifier(p, { baseUrl: e.target.value })} /></div>

                <div className="llm-sep">Modèles</div>
                <div className="llm-field"><label htmlFor={`llm-${p.id}-modele`}>Modèle par défaut</label>
                  {m.enTest
                    ? <span className="llm-hint">{d.defaultModel ? <code>{d.defaultModel}</code> : "aucun modèle choisi"} — Test des modèles en cours…</span>
                    : m.usable.length
                    ? <select id={`llm-${p.id}-modele`} className="bo-in" value={d.defaultModel} onChange={(e) => modifier(p, { defaultModel: e.target.value })}>{optionsModeles(m.options)}</select>
                    : <input id={`llm-${p.id}-modele`} className="bo-in mono" value={d.defaultModel} placeholder="ex. mistralai/mistral-small-2603" onChange={(e) => modifier(p, { defaultModel: e.target.value })} />}
                  <button className="bo-btn" type="button" onClick={() => recuperer(p)} disabled={enCours}><Icone nom="RotateCcw" size={13} />Récupérer la liste</button>
                </div>
                {m.exempt ? (
                  <div className="llm-note">{m.models.length ? `${pluriel(m.models.length, "modèle")} au catalogue${m.ecartes && !m.enTest ? `, dont ${pluriel(m.ecartes, "écarté")} au dernier test` : ""}${fetched ? ` · relevé le ${fetched}` : ""}` : "Catalogue non récupéré — saisir l'identifiant exact du modèle."} Liste blanche non appliquée : ce sont les <b>guardrails OpenRouter</b> qui bornent les modèles accessibles. Un modèle qu&apos;ils refusent fait échouer l&apos;appel, et la génération retombe sur le mock.</div>
                ) : (
                  <>
                    <div className="llm-note">{m.usable.length
                      ? `${pluriel(m.models.length, "modèle")} au catalogue, dont ${pluriel(m.usable.length, "autorisé")} par la liste blanche${m.ecartes && !m.enTest ? ` (${pluriel(m.ecartes, "écarté")} au dernier test)` : ""}${fetched ? ` · relevé le ${fetched}` : ""}`
                      : m.models.length
                        ? <>Aucun des {pluriel(m.models.length, "modèle")} du catalogue n&apos;est sur la liste blanche (<code>src/llm/allowlist.js</code>) — saisir un identifiant autorisé, ou en ajouter un par commit.</>
                        : "Catalogue non récupéré — saisir un identifiant de la liste blanche."}</div>
                    {p.defaultModel && !p.modelAllowed && <div className="llm-note warn"><Icone nom="Shield" size={12} /> <code>{p.defaultModel}</code> n&apos;est pas sur la liste blanche (<code>src/llm/allowlist.js</code>) : tout appel vers ce modèle est refusé avant envoi et replié sur le mock. Y ajouter un modèle demande un commit.</div>}
                  </>
                )}
                <EtatTest p={p} />
                {estRouteur(d.defaultModel) && <div className="llm-note warn"><Icone nom="Shield" size={12} /> <code>{d.defaultModel}</code> : {AVERTISSEMENT_ROUTEUR}. À réserver aux essais ; un prompt par modèle ne s&apos;y applique pas, et il est exclu des moteurs de relance.</div>}
                {(() => {
                  const v = p.defaultModel ? verdictDe(p, p.defaultModel) : null;
                  return v && !v.ok && <div className="llm-note warn"><Icone nom="Shield" size={12} /> Le modèle choisi <code>{p.defaultModel}</code> a échoué au dernier test : {v.motif}. Il reste sélectionné — un échec peut être passager — mais la génération se repliera sur le secours ou le mock s&apos;il ne répond pas.</div>;
                })()}
                <div className="llm-field"><label>Récupération auto</label>
                  <label className="llm-toggle"><input type="checkbox" checked={d.fetchModels} onChange={(e) => modifier(p, { fetchModels: e.target.checked })} /><span>Rafraîchir le catalogue avec le référentiel de sources</span></label>
                </div>

                <div className="llm-sep">État</div>
                <div className="llm-field"><label>Activé</label>
                  <label className="llm-toggle"><input type="checkbox" checked={d.enabled} onChange={(e) => modifier(p, { enabled: e.target.checked })} /><span>Disponible pour la génération</span></label>
                  {p.enabled && !p.active && <button className="bo-btn" type="button" onClick={() => activer(p)} disabled={enCours}><Icone nom="Check" size={13} />En faire le moteur actif</button>}
                </div>
                {(() => {
                  /* Secours = moteur + modèle (M3-88) : le moteur actif lui-même peut servir
                     de secours avec un autre modèle — même clé, rien à ressaisir. */
                  const cle = `secours:${p.id}`;
                  const courant = sec ? modeleSecours(p, moteurs) : p.defaultModel || "";
                  const c = choixRoles[cle] ?? courant;
                  const o = modelesProposes(p, moteurs.allowedModels, c);
                  const memeQueActif = p.active && c === (p.defaultModel || "");
                  return (
                    <div className="llm-field"><label htmlFor={`llm-${p.id}-secours`}>Secours</label>
                      {o.enTest
                        ? <span className="llm-hint">{c ? <code>{c}</code> : "aucun modèle"} — Test des modèles en cours…</span>
                        : <select id={`llm-${p.id}-secours`} className="bo-in" value={c} onChange={(e) => setChoixRoles((x) => ({ ...x, [cle]: e.target.value }))}>{c ? null : <option value="">— choisir un modèle —</option>}{optionsModeles(o.options)}</select>}
                      {sec
                        ? <>{c !== courant && <button className="bo-btn" type="button" onClick={() => secourir(p, c)} disabled={enCours || memeQueActif || !c}><Icone nom="Check" size={13} />Changer de modèle</button>}
                          <ConfirmationSurPlace libelle="Retirer le secours" icone="Trash" taille="petite" varianteDeclencheur="secondaire" desactive={enCours}
                            consequence={consequenceRetraitSecours(p.label)} libelleConfirmer="Retirer le secours" onConfirm={() => retirerSecours(p)} /></>
                        : <button className="bo-btn" type="button" onClick={() => secourir(p, c)} disabled={enCours || memeQueActif || !c || o.enTest}><Icone nom="RotateCcw" size={13} />En faire le moteur de secours</button>}
                      <span className="llm-hint">{memeQueActif
                        ? "C'est le modèle du moteur actif : en choisir un autre pour en faire un filet."
                        : sec ? (sec.ok ? "Prend le relais si le moteur actif échoue." : `Désigné, mais inopérant : ${sec.motif}.`) : ""}</span>
                    </div>
                  );
                })()}
                {moteurs.relectureActive && (() => {
                  /* Relecture = moteur + modèle (M3-89). L'activer reste un réglage des Paramètres. */
                  const cle = `relecture:${p.id}`;
                  const designe = moteurs.relectureId === p.id;
                  const courant = designe ? modeleRelecture(p, moteurs) : p.defaultModel || "";
                  const c = choixRoles[cle] ?? courant;
                  const o = modelesProposes(p, moteurs.allowedModels, c);
                  return (
                    <div className="llm-field"><label htmlFor={`llm-${p.id}-relecture`}>Relecture</label>
                      {o.enTest
                        ? <span className="llm-hint">{c ? <code>{c}</code> : "aucun modèle"} — Test des modèles en cours…</span>
                        : <select id={`llm-${p.id}-relecture`} className="bo-in" value={c} onChange={(e) => setChoixRoles((x) => ({ ...x, [cle]: e.target.value }))}>{c ? null : <option value="">— choisir un modèle —</option>}{optionsModeles(o.options)}</select>}
                      {(!designe || c !== courant) && <button className="bo-btn" type="button" onClick={() => relire(p, c)} disabled={enCours || !c || o.enTest}><Icone nom="Check" size={13} />{designe ? "Changer de modèle" : "En faire le moteur de relecture"}</button>}
                      {designe && c === courant && <span className="llm-hint">Relit chaque article généré.</span>}
                    </div>
                  );
                })()}

                <div className="llm-actions">
                  <button className="bo-btn primary" type="button" onClick={() => enregistrer(p)} disabled={enCours}><Icone nom="Check" size={13} />Enregistrer</button>
                  <button className="bo-btn" type="button" onClick={() => tester(p)} disabled={!p.hasKey || enCours}><Icone nom="Gauge" size={13} />Tester la connexion</button>
                  <ConfirmationSurPlace libelle="Supprimer" icone="Trash" desactive={enCours}
                    consequence={consequenceSuppressionMoteur(p.label, p.active)} libelleConfirmer="Supprimer le moteur" onConfirm={() => supprimer(p)} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
