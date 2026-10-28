"use server";

// Actions serveur de la relecture : décider, publier, régénérer, lire une
// notification, « voir comme ». Le travail reste dans src/api/*, par le pont.

import { cookies } from "next/headers";
import { action } from "@/pont";
import * as articles from "@/api/articles.js";
import * as meta from "@/api/meta.js";
import { ROLES } from "@shared/model.js";
import { readSettings } from "@/lib/yamlStore.js";
import { featsFor } from "@shared/feats.js";
import { tenter } from "@/resultat";
import { COOKIE_VOIR_COMME, roleEffectif, utilisateurCourant } from "@/session";
import { journalConsole } from "@/lib/journal.js";
import type { Moi } from "@/seConnecter/seConnecter.regles";
import { controlerParution, STATUTS_PARUTION, type Article } from "./relireArticles.regles";
import { lireArticle } from "./relireArticles.requetes";

const statut = action<Article>(articles.setStatus);
const parution = action<{ article: Article; publication: unknown }>(articles.publish);
const regen = action<Article>(articles.regenerate);
const lue = action<{ ok: boolean }>(meta.readNotification);
const moi = action<Moi>(meta.me);

/* M3-72 : les cinq critères, vérifiés ici et pas seulement sur le bouton.
   Réglages et rôle effectif (« Voir comme » compris) lus comme le fait le pont. */
async function contexteParution() {
  const [role, settings] = await Promise.all([utilisateurCourant().then(roleEffectif), readSettings()]);
  return { settings: settings as Record<string, unknown>, sansIllustration: !!featsFor(role, settings).sansIllustration };
}
async function refusParution(id: string) {
  const r = await tenter(controlerParution(id, { lireArticle, contexte: contexteParution }));
  if (!r.ok) return r;
  return r.data ? { ok: false as const, erreur: r.data, status: 409 } : null;
}

export async function changerStatut(id: string, status: string, reviewer: string) {
  const refus = STATUTS_PARUTION.has(status) ? await refusParution(id) : null;
  if (refus) return refus;
  return tenter(statut({ params: [id], body: { status, reviewer } }));
}

export async function publier(id: string, scheduledAt: string | null) {
  const refus = await refusParution(id);
  if (refus) return refus;
  return journalConsole(scheduledAt ? "parution programmée" : "parution", await tenter(parution({ params: [id], body: { scheduledAt } })), { user: await utilisateurCourant(), detail: scheduledAt ? { scheduledAt } : null });
}

export async function regenerer(id: string, altPrompt: string | null, force: boolean) {
  return journalConsole("régénération", await tenter(regen({ params: [id], body: { altPrompt, force } })), { user: await utilisateurCourant(), detail: { consigne: !!altPrompt, force } });
}

export async function marquerNotificationLue(id: string) {
  return tenter(lue({ params: [id] }));
}

/* « Voir comme » : un administrateur endosse un autre rôle le temps d'une
   consultation. L'ancien front envoyait un en-tête à chaque appel ; une action
   serveur n'en porte pas, le choix vit donc dans un cookie de session, que le
   pont lit à défaut de l'en-tête. Le serveur l'ignore pour tout autre compte. */
export async function voirComme(role: string) {
  const magasin = await cookies();
  if (role && role in ROLES) magasin.set(COOKIE_VOIR_COMME, role, { path: "/", httpOnly: true, sameSite: "lax" });
  else magasin.delete(COOKIE_VOIR_COMME);
  return tenter(moi({}));
}

export async function relireMoi() {
  return tenter(moi({}));
}
