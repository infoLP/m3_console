"use client";

// Onglet Sécurité (M3-44) : la liste noire d'adresses IP. Lister, débannir,
// bannir à la main. Le serveur refuse ce qu'il ne faut jamais bannir (proxy,
// réseau interne, sa propre adresse) ; l'écran le dit avant de demander.

import { useState, useTransition } from "react";
import { Icone } from "@/composants/Icone";
import { ConfirmationSurPlace } from "@/composants/primitives";
import { useFlash } from "@/composants/Toast";
import { libelleMotif, refusBannissement, type ListeNoire } from "@/gererListeNoire/gererListeNoire.regles";
import { consequenceDebannissement } from "./TableauListeNoire.consequences";
import { bannir, debannir, relireListeNoire } from "@/gererListeNoire/gererListeNoire.action";

export function TableauListeNoire({ initiale }: { initiale: ListeNoire }) {
  const flash = useFlash();
  const [liste, setListe] = useState<ListeNoire>(initiale);
  const [ip, setIp] = useState("");
  const [note, setNote] = useState("");
  const [enCours, lancer] = useTransition();

  const relire = async () => {
    const r = await relireListeNoire();
    if (r.ok) setListe(r.data);
  };

  const ajouter = () => lancer(async () => {
    const refus = refusBannissement(ip, liste);
    if (refus) return flash(refus, true);
    const r = await bannir(ip.trim(), note);
    if (!r.ok) return flash(r.erreur, true);
    setIp(""); setNote("");
    flash(`${r.data.ip} ajoutée à la liste noire`);
    await relire();
  });

  const retirer = async (adresse: string) => {
    const r = await debannir(adresse);
    if (!r.ok) throw new Error(r.erreur);
    flash(`${r.data.ip} retirée de la liste noire`);
    await relire();
  };

  return (
    <>
      <div className="bo-card"><h3>Liste noire d&apos;adresses IP <span className="bo-note">{liste.bans.length} adresse(s)</span></h3>
        <p className="bo-hint">
          {liste.threshold
            ? <>Une adresse est bannie après <strong>{liste.threshold} connexions par mot de passe refusées</strong> en {liste.windowHours} h.</>
            : <>Le bannissement automatique est désactivé (<code>M3_IP_BAN_THRESHOLD=0</code>) ; la liste reste appliquée.</>}
          {" "}Une adresse bannie ne peut plus se connecter par mot de passe ; la connexion Windows (Entra) n&apos;est pas concernée.
          Les identifiants tentés ne sont montrés en entier que s&apos;ils correspondent à un compte : sinon, c&apos;est peut-être un mot de passe.
        </p>
        <p className="bo-hint">
          Votre adresse vue par le serveur : <code>{liste.selfIp || "inconnue"}</code>.
          {" "}Proxys de confiance : {liste.trustedProxies.length ? <code>{liste.trustedProxies.join(", ")}</code> : <strong>aucun — derrière Traefik, aucune adresse ne peut être bannie</strong>}.
          {liste.exempt.length > 0 && <> Exemptées : <code>{liste.exempt.join(", ")}</code>.</>}
          {" "}Si vous vous êtes banni : <code>node src/tools/ipBanAdmin.js --unban &lt;adresse&gt;</code>.
        </p>
        {liste.bans.length ? (
          <div className="bo-scroll"><table className="bo-table"><thead><tr><th>Adresse</th><th>Depuis</th><th>Motif</th><th>Identifiants tentés</th><th>Note</th><th></th></tr></thead><tbody>
            {liste.bans.map((b) => (
              <tr key={b.ip}>
                <td className="mono">{b.ip}</td>
                <td>{new Date(b.bannedAt).toLocaleString("fr-FR")}</td>
                <td>{libelleMotif(b)}</td>
                <td>{b.logins.length ? b.logins.join(", ") : "—"}</td>
                <td>{b.note || "—"}</td>
                <td><ConfirmationSurPlace libelle="Débannir" taille="petite" varianteDeclencheur="secondaire" desactive={enCours}
                  consequence={consequenceDebannissement(b.ip)} libelleConfirmer="Débannir" onConfirm={() => retirer(b.ip)} /></td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="bo-note">Aucune adresse bannie.</p>}
      </div>
      <div className="bo-card"><h3>Bannir une adresse à la main</h3>
        <div className="bo-actions">
          <input name="ip" aria-label="Adresse IP à bannir" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.7" className="bo-ip" />
          <input name="note" aria-label="Motif du bannissement" value={note} onChange={(e) => setNote(e.target.value)} placeholder="motif (facultatif)" className="bo-motif" />
          <button className="bo-btn danger" type="button" onClick={ajouter} disabled={enCours}><Icone nom="Shield" size={13} />Bannir</button>
        </div>
      </div>
    </>
  );
}
