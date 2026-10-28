"use client";

// La liste est lue AVANT d'ouvrir la fenêtre (store.ouvrirNotifications) : elle
// arrive en propriété, et « Lu » la relit depuis un gestionnaire d'événement.

import Link from "next/link";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { libelle, lienNotification, type Notification } from "@/suivreNotifications/suivreNotifications.regles";
import { marquerNotificationLue } from "@/relireArticles/relireArticles.action";
import { useConsole } from "../store";
import { Modale } from "./Modale";

export function ModaleNotifications({ liste }: { liste: Notification[] }) {
  const c = useConsole();
  const flash = useFlash();
  const lire = async (id: string) => {
    const r = await marquerNotificationLue(id);
    if (!r.ok) return flash(r.erreur, true);
    await c.ouvrirNotifications();
  };
  return (
    <Modale titre="Notifications" onClose={c.fermerModale}>
      {liste.length ? liste.map((n) => (
        <div key={n.id} className={`md-notif${n.read ? " lu" : ""}`}>
          <span className={`md-notif-ic md-notif-ic--${n.severity}`}><Icone nom="Bell" size={15} /></span>
          <div className="md-notif-corps">
            <div className="md-notif-t">{libelle(n)}{n.sourceName ? ` — ${n.sourceName}` : ""}</div>
            <div className="md-notif-d">{n.detail || n.error || ""}</div>
            <div className="md-notif-at">{new Date(n.at).toLocaleString("fr-FR")}<LienNotification n={n} /></div>
          </div>
          {!n.read && <button className="cr-btn ghost md-petit" type="button" onClick={() => lire(n.id)}>Lu</button>}
        </div>
      )) : <p className="md-vide">Aucune notification.</p>}
    </Modale>
  );
}

/* Lien interne (candidats) : la fenêtre se ferme, le back-office s'ouvre. */
function LienNotification({ n }: { n: Notification }) {
  const c = useConsole();
  const l = lienNotification(n);
  if (!l) return null;
  return <> · {l.externe ? <a href={l.href} target="_blank" rel="noreferrer">{l.libelle}</a> : <Link href={l.href} onClick={c.fermerModale}>{l.libelle}</Link>}</>;
}
