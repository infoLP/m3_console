"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Icone } from "@/composants/Icone";
import { ConfirmationSurPlace } from "@/composants/primitives";
import { useFlash } from "@/composants/Toast";
import Link from "next/link";
import { libelle, lienNotification, type Notification } from "@/suivreNotifications/suivreNotifications.regles";
import { marquerLue, purgerLues } from "@/suivreNotifications/suivreNotifications.action";
import { consequencePurge } from "./ListeNotifications.consequences";

export function ListeNotifications({ notifications }: { notifications: Notification[] }) {
  const flash = useFlash();
  const router = useRouter();
  const [enCours, lancer] = useTransition();
  const nRead = notifications.filter((n) => n.read).length;

  const lire = (id: string) => lancer(async () => {
    const r = await marquerLue(id);
    if (!r.ok) return flash(r.erreur, true);
    router.refresh();
  });
  const purger = async () => {
    const r = await purgerLues();
    if (!r.ok) throw new Error(r.erreur);
    flash(`${r.data.removed} notification(s) lue(s) supprimée(s)`);
    router.refresh();
  };

  return (
    <div className="bo-card">
      <h3>Notifications <span className="bo-note">{notifications.length - nRead} non lue(s) · {nRead} lue(s)</span></h3>
      <div className="bo-actions"><ConfirmationSurPlace libelle={`Purger les lues${nRead ? ` (${nRead})` : ""}`} icone="Trash" desactive={!nRead || enCours}
          consequence={consequencePurge(nRead)} libelleConfirmer="Purger pour tous" onConfirm={purger} /></div>
      {notifications.length ? notifications.map((n) => (
        <div key={n.id} className={n.read ? "bo-row-line bo-row-line--lu" : "bo-row-line"}>
          <span className={`bo-sev-${n.severity || "info"}`}><Icone nom="Bell" size={15} /></span>
          <div className="bo-grow"><b>{libelle(n)}</b>{n.sourceName ? ` — ${n.sourceName}` : ""}
            <div className="bo-note">{n.detail || n.error || ""}</div>
            <div className="bo-note">{new Date(n.at).toLocaleString("fr-FR")}<LienNotification n={n} /></div></div>
          {!n.read && <button className="bo-btn" type="button" onClick={() => lire(n.id)} disabled={enCours}>Marquer lue</button>}
        </div>
      )) : <p className="bo-note">Aucune notification.</p>}
    </div>
  );
}

function LienNotification({ n }: { n: Notification }) {
  const l = lienNotification(n);
  if (!l) return null;
  return <> · {l.externe ? <a href={l.href} target="_blank" rel="noreferrer">{l.libelle}</a> : <Link href={l.href}>{l.libelle}</Link>}</>;
}
