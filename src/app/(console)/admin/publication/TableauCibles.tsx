"use client";

// Onglet Publication (M3-53) : les sites WordPress sur lesquels M3 peut envoyer
// un article. Créer, modifier, tester la connexion, désactiver, supprimer. Le mot
// de passe d'application n'est jamais relu : à la modification, vide = on garde
// l'ancien. L'interrupteur général (publication simulée ou réelle) est une
// variable d'environnement : il se lit ici, il ne se change pas ici.

import { useState, useTransition } from "react";
import { Icone } from "@/composants/Icone";
import { ConfirmationSurPlace, Message } from "@/composants/primitives";
import { useFlash } from "@/composants/Toast";
import {
  GREFFONS, SAISIE_VIDE, STATUTS, avertissements, libelleArrivee, libelleGreffon, refusSaisie, saisieDe,
  type CiblePublique, type EtatPublication, type Greffon, type Saisie, type StatutArrivee,
} from "@/gererCiblesWordpress/gererCiblesWordpress.regles";
import { activer, creer, modifier, relireEtatPublication, supprimer, tester } from "@/gererCiblesWordpress/gererCiblesWordpress.action";
import { consequenceDesactivation, consequenceSuppression } from "./TableauCibles.consequences";

export function TableauCibles({ initial }: { initial: EtatPublication }) {
  const flash = useFlash();
  const [etat, setEtat] = useState<EtatPublication>(initial);
  const [saisie, setSaisie] = useState<Saisie>(SAISIE_VIDE);
  const [edition, setEdition] = useState<CiblePublique | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, { ok: boolean; message: string }>>({});
  const [enCours, lancer] = useTransition();

  const relire = async () => {
    const r = await relireEtatPublication();
    if (r.ok) setEtat(r.data);
  };
  const champ = <K extends keyof Saisie>(k: K, v: Saisie[K]) => setSaisie((s) => ({ ...s, [k]: v }));
  const annuler = () => { setEdition(null); setSaisie(SAISIE_VIDE); };

  const enregistrer = () => lancer(async () => {
    const refus = refusSaisie(saisie, { creation: !edition });
    if (refus) return flash(refus, true);
    const r = edition ? await modifier(edition.id, saisie) : await creer(saisie);
    if (!r.ok) return flash(r.erreur, true);
    flash(edition ? `Cible « ${r.data.target.name} » modifiée` : `Cible « ${r.data.target.name} » créée`);
    annuler();
    await relire();
  });

  const essayer = (c: CiblePublique) => lancer(async () => {
    const r = await tester(c.id);
    if (!r.ok) return flash(r.erreur, true);
    setVerdicts((v) => ({ ...v, [c.id]: { ok: r.data.ok, message: r.data.message } }));
  });

  const basculer = async (c: CiblePublique) => {
    const r = await activer(c.id, !c.active);
    if (!r.ok) throw new Error(r.erreur);
    flash(c.active ? `Cible « ${c.name} » désactivée` : `Cible « ${c.name} » activée`);
    await relire();
  };

  const retirer = async (c: CiblePublique) => {
    const r = await supprimer(c.id);
    if (!r.ok) throw new Error(r.erreur);
    flash(`Cible « ${c.name} » supprimée`);
    if (edition?.id === c.id) annuler();
    await relire();
  };

  const alertes = avertissements(etat);

  return (
    <>
      <div className="bo-card"><h3>Publication WordPress
        <span className="bo-note">{etat.mode === "wordpress" ? "mode réel" : "mode simulé"}</span></h3>
        <p className="bo-hint">
          Un article « envoyé en parution » part vers la <strong>cible par défaut</strong> ci-dessous, en brouillon ou
          en ligne selon son réglage. Le mode réel ou simulé est réglé par l&apos;exploitant (<code>M3_PUBLISH_MODE</code>),
          pas depuis cet écran : tant qu&apos;il vaut <code>simulated</code>, rien ne quitte M3.
          {etat.simulatedTarget && etat.mode === "simulated" && <> Site simulé : <code>{etat.simulatedTarget}</code>.</>}
        </p>
        {alertes.map((a) => <Message key={a} ton="avertissement">{a}</Message>)}
      </div>

      <div className="bo-card"><h3>Cibles <span className="bo-note">{etat.targets.length} cible(s)</span></h3>
        {etat.targets.length ? (
          <div className="bo-scroll"><table className="bo-table"><thead><tr>
            <th>Nom</th><th>Site</th><th>Compte</th><th>Mot de passe</th><th>SEO</th><th>Arrivée</th><th>État</th><th></th></tr></thead><tbody>
            {etat.targets.map((c) => (
              <tr key={c.id}>
                <td>{c.name}{c.isDefault && <> <span className="bo-pill">par défaut</span></>}</td>
                <td className="mono">{c.url}</td>
                <td>{c.wpUser}</td>
                <td className="mono">{c.secretHint || "—"}</td>
                <td>{libelleGreffon(c.seoPlugin)}{c.createCategories ? " · crée les rubriques" : ""}</td>
                <td>{libelleArrivee(c.publishStatus)}</td>
                <td>{c.active ? <span className="bo-ok">active</span> : <span className="bo-discret">désactivée</span>}
                  {verdicts[c.id] && <div className={verdicts[c.id].ok ? "bo-ok" : "bo-note"}>{verdicts[c.id].message}</div>}</td>
                <td>
                  <div className="bo-actions">
                    <button className="bo-btn" type="button" disabled={enCours || !c.active} onClick={() => essayer(c)}>Tester</button>
                    <button className="bo-btn" type="button" disabled={enCours} onClick={() => { setEdition(c); setSaisie(saisieDe(c)); }}><Icone nom="Pencil" size={13} />Modifier</button>
                    {c.active
                      ? <ConfirmationSurPlace libelle="Désactiver" taille="petite" varianteDeclencheur="secondaire" desactive={enCours}
                          consequence={consequenceDesactivation(c.name, c.isDefault)} libelleConfirmer="Désactiver" onConfirm={() => basculer(c)} />
                      : <>
                          <button className="bo-btn" type="button" disabled={enCours} onClick={() => basculer(c)}>Réactiver</button>
                          <ConfirmationSurPlace libelle="Supprimer" taille="petite" desactive={enCours}
                            consequence={consequenceSuppression(c.name)} libelleConfirmer="Supprimer" onConfirm={() => retirer(c)} />
                        </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="bo-note">Aucune cible. Tant qu&apos;il n&apos;y en a pas, aucun article ne peut partir vers WordPress.</p>}
      </div>

      <div className="bo-card"><h3>{edition ? `Modifier « ${edition.name} »` : "Ajouter une cible"}</h3>
        <div className="bo-actions">
          <input name="name" aria-label="Nom de la cible" placeholder="Nom (ex. Vie économique)" value={saisie.name} onChange={(e) => champ("name", e.target.value)} />
          <input name="url" aria-label="Adresse du site WordPress" placeholder="https://site.exemple.fr" value={saisie.url} onChange={(e) => champ("url", e.target.value)} />
          <input name="wpUser" aria-label="Compte WordPress" placeholder="Compte (rôle Éditeur)" value={saisie.wpUser} onChange={(e) => champ("wpUser", e.target.value)} />
          <input type="password" name="password" autoComplete="new-password" aria-label="Mot de passe d'application"
            placeholder={edition ? "inchangé si vide" : "Mot de passe d'application"} value={saisie.password} onChange={(e) => champ("password", e.target.value)} />
        </div>
        <div className="bo-actions">
          <select name="seoPlugin" aria-label="Greffon SEO du site" value={saisie.seoPlugin} onChange={(e) => champ("seoPlugin", e.target.value as Greffon)}>
            {GREFFONS.map(([id, libelle]) => <option key={id} value={id}>{libelle}</option>)}
          </select>
          <select name="publishStatus" aria-label="Statut d'arrivée dans WordPress" value={saisie.publishStatus} onChange={(e) => champ("publishStatus", e.target.value as StatutArrivee)}>
            {STATUTS.map(([id, libelle]) => <option key={id} value={id}>{libelle}</option>)}
          </select>
          <label className="bo-check"><input type="checkbox" name="createCategories" checked={saisie.createCategories} onChange={(e) => champ("createCategories", e.target.checked)} /> Créer les rubriques absentes</label>
          <label className="bo-check"><input type="checkbox" name="isDefault" checked={saisie.isDefault} onChange={(e) => champ("isDefault", e.target.checked)} /> Cible par défaut</label>
        </div>
        <p className="bo-hint">Le mot de passe d&apos;application se crée dans WordPress (profil du compte, « Mots de passe d&apos;application »)
          pour un compte <strong>Éditeur</strong>. Il est chiffré en base et ne s&apos;affiche plus jamais. Pour changer la cible par défaut,
          cochez la case sur une autre cible. Une cible neuve arrive en <strong>brouillon</strong> : à vous de choisir la mise en ligne directe.</p>
        <div className="bo-actions">
          <button className="bo-btn primary" type="button" onClick={enregistrer} disabled={enCours}><Icone nom={edition ? "Check" : "Plus"} size={13} />{edition ? "Enregistrer" : "Ajouter la cible"}</button>
          {edition && <button className="bo-btn" type="button" onClick={annuler} disabled={enCours}>Annuler</button>}
        </div>
      </div>
    </>
  );
}
