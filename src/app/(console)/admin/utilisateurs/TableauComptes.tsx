"use client";

// Onglet Utilisateurs, porté de usersView(). Les champs sont contrôlés : plus
// besoin de « relever les saisies avant de re-rendre », le défaut qui avait fait
// disparaître un nom et un login le 2026-09-15.

import { useState, useTransition } from "react";
import { Icone } from "@/composants/Icone";
import { ConfirmationSurPlace } from "@/composants/primitives";
import { useFlash } from "@/composants/Toast";
import { ROLES } from "@shared/model.js";
import { comptesModifies, motDePasseAcceptable, nouveauCompte, type Compte } from "@/gererComptes/gererComptes.regles";
import { consequenceMotDePasse, consequenceRetraitCompte } from "./TableauComptes.consequences";
import { definirMotDePasse, enregistrerComptes } from "@/gererComptes/gererComptes.action";

const ROLES_LISTE = Object.entries(ROLES as Record<string, string>);

export function TableauComptes({ initiaux }: { initiaux: Compte[] }) {
  const flash = useFlash();
  const [comptes, setComptes] = useState<Compte[]>(initiaux);
  const [reference, setReference] = useState<Compte[]>(initiaux);
  const [mdp, setMdp] = useState<Record<string, string>>({});
  const [enCours, lancer] = useTransition();

  const modifier = (i: number, champ: keyof Compte, valeur: string) =>
    setComptes((l) => l.map((u, j) => (j === i ? { ...u, [champ]: valeur } : u)));

  const enregistrer = () => lancer(async () => {
    const r = await enregistrerComptes(comptes);
    if (!r.ok) return flash(r.erreur, true);
    setComptes(r.data.users); setReference(r.data.users);
    flash("Utilisateurs enregistrés");
  });

  /* Contrôles avant la demande : un mot de passe refusé n'ouvre pas la confirmation. */
  const problemeMdp = (u: Compte) => (u.canLogin === undefined
    ? "Enregistrez d'abord le compte, puis définissez son mot de passe."
    : motDePasseAcceptable(mdp[u.id] || ""));

  const definir = async (u: Compte) => {
    const probleme = problemeMdp(u);
    if (probleme) throw new Error(probleme);
    const r = await definirMotDePasse(u.id, mdp[u.id] || "");
    if (!r.ok) throw new Error(r.erreur);
    setMdp((m) => ({ ...m, [u.id]: "" }));
    /* Surtout PAS de rechargement depuis le serveur : il écraserait les saisies
       en cours. On met simplement à jour l'indicateur de la ligne. */
    setComptes((l) => l.map((x) => (x.id === u.id ? { ...x, canLogin: true } : x)));
    const reste = comptesModifies(comptes, reference);
    flash(`Mot de passe défini pour ${r.data.login}`
      + (r.data.sessionsFermees ? ` — ${r.data.sessionsFermees} session(s) fermée(s)` : "")
      + (reste ? ". Nom, login et rôle ne sont PAS enregistrés : cliquez sur Enregistrer." : ""), reste);
  };

  return (
    <div className="bo-card"><h3>Utilisateurs &amp; rôles
      <button className="bo-btn primary" type="button" onClick={enregistrer} disabled={enCours}><Icone nom="Check" size={13} />Enregistrer</button></h3>
      <p className="bo-hint">Le login doit être <strong>l&apos;adresse Windows exacte</strong> de la personne
        — chez nous <code>p.nom@legalprime.fr</code>, l&apos;initiale du prénom et non le prénom entier.
        C&apos;est elle qui rattache le compte le jour du SSO : une adresse approchée ne rattache rien, et
        la personne se verra refuser l&apos;entrée. Le mot de passe se définit ligne par ligne,
        séparément de l&apos;enregistrement — et il ferme les sessions ouvertes du compte.</p>
      <div className="bo-scroll"><table className="bo-table"><thead><tr><th>Nom</th><th>Login</th><th>Rôle</th><th>Connexion</th><th>Mot de passe</th><th></th></tr></thead><tbody>
        {comptes.map((u, i) => (
          <tr key={u.id}>
            <td><input name="name" aria-label={`Nom du compte ${u.login || u.name}`} value={u.name} onChange={(e) => modifier(i, "name", e.target.value)} /></td>
            <td><input name="login" aria-label={`Login de ${u.name}`} value={u.login || ""} onChange={(e) => modifier(i, "login", e.target.value)} /></td>
            <td><select name="role" aria-label={`Rôle de ${u.name}`} value={u.role} onChange={(e) => modifier(i, "role", e.target.value)}>{ROLES_LISTE.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            <td>{u.canLogin ? <span className="bo-ok">active</span> : <span className="bo-discret">aucun mot de passe</span>}</td>
            <td><input type="password" name="password" aria-label={`Nouveau mot de passe de ${u.name}`} value={mdp[u.id] || ""} onChange={(e) => setMdp((m) => ({ ...m, [u.id]: e.target.value }))} placeholder="8 caractères minimum" autoComplete="new-password" className="bo-mdp" />
              <ConfirmationSurPlace libelle="Définir" taille="petite" varianteDeclencheur="secondaire" desactive={enCours}
                consequence={consequenceMotDePasse(u)} libelleConfirmer="Définir et fermer les sessions" onConfirm={() => definir(u)} /></td>
            <td><ConfirmationSurPlace libelle="Retirer" taille="petite" consequence={consequenceRetraitCompte(u)} libelleConfirmer="Retirer le compte"
                onConfirm={() => setComptes((l) => l.filter((_, j) => j !== i))} /></td>
          </tr>
        ))}
      </tbody></table></div>
      <div className="bo-actions bo-actions--apres"><button className="bo-btn" type="button" onClick={() => setComptes((l) => [...l, nouveauCompte()])}><Icone nom="Plus" size={13} />Ajouter un utilisateur</button></div>
    </div>
  );
}
