"use client";

// La file du jour en tiroir gauche (M3-107, axe C2), sous 1000 px : l'article
// prend alors toute la largeur. Même composant Rail qu'en colonne. Choisir un
// article referme le tiroir (le focus revient au bouton qui l'a ouvert) ;
// Échap et le voile aussi, comme tout Tiroir.

import { useEffect, useRef } from "react";
import { Tiroir } from "@/composants/primitives";
import { Rail } from "./Rail";
import { useConsole } from "./store";

export function TiroirFile({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const { selId } = useConsole();
  const selOuverture = useRef(selId);
  /* Seule une sélection faite PENDANT que le tiroir est ouvert le referme. */
  useEffect(() => {
    if (!ouvert) { selOuverture.current = selId; return; }
    if (selId !== selOuverture.current) onFermer();
  }, [ouvert, selId, onFermer]);

  return (
    <Tiroir ouvert={ouvert} onFermer={onFermer} cote="gauche" titre="File du jour" libelleFermer="Fermer la file" className="cr-tiroir-file">
      <Rail enTiroir />
    </Tiroir>
  );
}
