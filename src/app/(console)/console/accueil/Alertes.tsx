// Alertes (M3-108, palier administrateur) : ce qui demande l'œil de
// l'administrateur, regroupé par type, les plus graves en tête, avec le lien
// vers la page du back-office qui permet d'agir. Le super utilisateur n'y voit
// que « source mise à l'écart », sans lien : le back-office lui est fermé (M3-57).

import Link from "next/link";
import { Carte, Etiquette, Message, Vide } from "@/composants/primitives";

export type Alerte = { cle: string; ton: "stop" | "amber"; titre: string; nombre: number; texte: string; at: string; href: string | null };

const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Alertes({ alertes }: { alertes: Alerte[] | "indisponible" }) {
  if (alertes === "indisponible") {
    return <Carte titre="Alertes"><Message ton="avertissement">Les notifications et les demandes au worker n&apos;ont pas pu être lues.</Message></Carte>;
  }
  return (
    <Carte titre="Alertes" actions={<span className="text-xs text-ink-2">dernières 24 h, non lues</span>}>
      {!alertes.length ? <Vide compact titre="Aucune alerte" message="Ni erreur ni avertissement non lu depuis 24 h, et le worker prend les demandes." /> : (
        <ul className="grid gap-2">
          {alertes.map((a) => (
            <li key={a.cle} className="grid grid-cols-[auto_1fr_auto] gap-3 items-baseline text-sm">
              <Etiquette ton={a.ton}>{a.nombre > 1 ? `${a.nombre} ×` : "1 ×"}</Etiquette>
              <span><b>{a.titre}</b>{a.texte ? <> — {a.texte}</> : null} <span className="text-xs text-ink-2">({quand(a.at)})</span></span>
              {a.href ? <Link className="text-brand text-xs" href={a.href}>Voir</Link> : <span />}
            </li>
          ))}
        </ul>
      )}
    </Carte>
  );
}
