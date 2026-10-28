// Résultat d'une action serveur : on RETOURNE l'erreur, on ne la lève pas.
// En production, Next.js remplace le message d'une erreur levée dans une
// action par un texte générique et un digest — « réservé à l'administrateur »
// ou « Une exécution est déjà en cours » n'arriveraient jamais à l'écran.

import { unstable_rethrow } from "next/navigation";

export type Resultat<T> = { ok: true; data: T } | { ok: false; erreur: string; status?: number };

export async function tenter<T>(promesse: Promise<T>): Promise<Resultat<T>> {
  try {
    return { ok: true, data: await promesse };
  } catch (err) {
    /* Une redirection ou un notFound() de Next ne sont pas des erreurs à
       rendre : on les laisse remonter. */
    unstable_rethrow(err);
    const e = err as { message?: string; status?: number };
    return { ok: false, erreur: e?.message || String(err), status: e?.status };
  }
}
