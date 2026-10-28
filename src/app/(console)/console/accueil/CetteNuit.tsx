// « Cette nuit » (M3-108, palier super utilisateur) : la dernière chaîne
// planifiée, en une ligne d'état et trois chiffres ; les sources en cause au
// clic, sur place — le super utilisateur n'a pas le back-office.

import { Carte, Etiquette, Message, Tuile, Vide } from "@/composants/primitives";

export type Nuit =
  | { statut: "aucune"; planifiee: boolean; prochaine: string | null }
  | { statut: "ok" | "partielle" | "echec"; slot: string | null; erreur: string | null;
      recolte: { items: number; echecs: string[]; muettes: string[] } | null;
      generation: { crees: number; plafond: boolean } | null; prochaine: string | null };

const creneau = (slot: string | null) => (slot ? `${slot.slice(8, 10)}/${slot.slice(5, 7)} à ${slot.slice(11)}` : "—");
const ETAT = { ok: { ton: "go", texte: "terminée" }, partielle: { ton: "amber", texte: "partielle" }, echec: { ton: "stop", texte: "en échec" } } as const;
const plural = (n: number) => (n > 1 ? "s" : "");

export function CetteNuit({ nuit }: { nuit: Nuit | "indisponible" }) {
  if (nuit === "indisponible") {
    return <Carte titre="Cette nuit"><Message ton="avertissement">L&apos;état de la chaîne planifiée n&apos;a pas pu être lu.</Message></Carte>;
  }
  if (nuit.statut === "aucune") {
    return (
      <Carte titre="Cette nuit">
        <Vide compact titre="Aucune chaîne planifiée exécutée"
          message={nuit.planifiee ? `Prochaine : ${creneau(nuit.prochaine)}.` : "La planification est désactivée (Paramètres, « Planification »)."} />
      </Carte>
    );
  }
  const e = ETAT[nuit.statut];
  const r = nuit.recolte, g = nuit.generation;
  return (
    <Carte titre="Cette nuit" actions={<span className="text-xs text-ink-2">chaîne de {creneau(nuit.slot)}</span>}>
      <p className="text-sm mb-3"><Etiquette ton={e.ton}>{e.texte}</Etiquette>
        {nuit.erreur ? <> {nuit.erreur}</> : null}{g?.plafond ? <> Plafond de dépense LLM atteint pendant la génération.</> : null}</p>
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
        <Tuile libelle={`contenu${plural(r?.items || 0)} récolté${plural(r?.items || 0)}`} valeur={r ? r.items : "—"} />
        <Tuile libelle={`article${plural(g?.crees || 0)} généré${plural(g?.crees || 0)}`} valeur={g ? g.crees : "—"} />
        <Tuile libelle="sources en échec ou muettes" valeur={r ? r.echecs.length + r.muettes.length : "—"} ton={r && r.echecs.length ? "stop" : r && r.muettes.length ? "amber" : "neutre"} />
      </div>
      {r && (r.echecs.length > 0 || r.muettes.length > 0) && (
        <details className="mt-3">
          <summary className="text-sm text-ink-2 cursor-pointer">Sources en cause</summary>
          {r.echecs.length > 0 && <p className="text-sm mt-2"><b>En échec ({r.echecs.length}) :</b> {r.echecs.join(", ")}</p>}
          {r.muettes.length > 0 && <p className="text-sm mt-2"><b>Muettes ({r.muettes.length}) :</b> {r.muettes.join(", ")} — elles ont répondu sans rien rendre.</p>}
        </details>
      )}
    </Carte>
  );
}
