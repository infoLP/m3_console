"use server";

import { action } from "@/pont";
import * as llm from "@/api/llm.js";
import * as meta from "@/api/meta.js";
import { unstable_rethrow } from "next/navigation";
import { tenter } from "@/resultat";
import { valeurSecours, type Moteur, type Moteurs, type VersionPrompt } from "./gererMoteursIA.regles";

const creer = action<{ ok: boolean; provider: Moteur }>(llm.create);
const enregistrer = action<{ ok: boolean; provider: Moteur }>(llm.save);
const supprimer = action<{ ok: boolean }>(llm.remove);
const activer = action<Moteurs>(llm.activate);
const modeles = action<{ ok: boolean; count: number }>(llm.fetchModels);
const testerModeles = action<{ ok: boolean; total: number; job: { id: number; duplicate: boolean } }>(llm.testModels);
const tester = action<{ ok: boolean; ms: number; model: string; error?: string }>(llm.test);
const enregistrerReglages = action<{ ok: boolean }>(meta.saveSettings);

export async function ajouterMoteur() {
  const id = "llm-" + Date.now().toString(36);
  return tenter(creer({ body: { id, label: "Nouveau moteur", kind: "openai", baseUrl: "https://" } }).then((r) => ({ ...r, id })));
}

export async function enregistrerMoteur(id: string, patch: Record<string, unknown>) {
  return tenter(enregistrer({ params: [id], body: patch }));
}

export async function retirerCle(id: string) {
  return tenter(enregistrer({ params: [id], body: { clearKey: true } }));
}

/* Enregistrer avant d'activer, de récupérer ou de tester : sinon une
   modification non sauvegardée (clé collée, modèle choisi) serait perdue. */
export async function activerMoteur(id: string, patch: Record<string, unknown>) {
  return tenter(enregistrer({ params: [id], body: patch }).then(() => activer({ params: [id], body: {} })));
}

/* Récupérer, PUIS déposer le test de tous les modèles au worker. Le test qui ne
   peut pas partir (pas de clé, rien à tester) ne fait pas échouer la
   récupération, qui a bien eu lieu : son motif est rendu à part. */
export async function recupererModeles(id: string, patch: Record<string, unknown>) {
  return tenter((async () => {
    await enregistrer({ params: [id], body: patch });
    const r = await modeles({ params: [id], body: {} });
    const t = await tenter(testerModeles({ params: [id], body: {} }));
    return { count: r.count, test: t.ok ? { total: t.data.total, deja: t.data.job.duplicate } : { erreur: t.erreur } };
  })());
}

export async function testerMoteur(id: string, patch: Record<string, unknown>) {
  return tenter(enregistrer({ params: [id], body: patch }).then(() => tester({ params: [id], body: {} })));
}

/* Désigne le moteur de secours (M3-88) et son modèle, ou le retire (null).
   Ce sont des réglages comme les autres : même droit, même historique, même
   journal que l'onglet Paramètres, où ils se règlent aussi. Modèle vide = le
   modèle par défaut du moteur. */
export async function definirSecours(id: string | null, modele = "") {
  return tenter(enregistrerReglages({ body: { llm_fallback_provider: valeurSecours(id), llm_fallback_model: id ? modele.trim() : "" } }));
}

/* Moteur + modèle de la relecture automatique (M3-89). L'activer reste un
   réglage des Paramètres : ici on choisit qui relit, et avec quel modèle. */
export async function definirRelecture(id: string, modele = "") {
  return tenter(enregistrerReglages({ body: { llm_review_provider: id, llm_review_model: modele.trim() } }));
}

export async function supprimerMoteur(id: string) {
  return tenter(supprimer({ params: [id] }));
}

/* ------------------------------------------------- prompts de génération */

type Ecriture = { ok: boolean; prompt: VersionPrompt; history: VersionPrompt[] };
const enregistrerPromptApi = action<Ecriture>(llm.savePrompt);
const restaurerPromptApi = action<Ecriture>(llm.restorePrompt);
const supprimerPromptApi = action<Ecriture>(llm.removePrompt);
const historiqueApi = action<{ history: VersionPrompt[] }>(llm.promptHistory);
const apercuApi = action<{ ok: boolean; errors: string[]; text: string }>(llm.previewPrompt);

/* Comme `tenter`, mais garde la liste d'erreurs de validation que le serveur
   rend avec un refus 400 (`errors`) : l'écran les affiche toutes. */
export type ResultatPrompt<T> = { ok: true; data: T } | { ok: false; erreur: string; erreurs: string[] };
async function tenterPrompt<T>(p: Promise<T>): Promise<ResultatPrompt<T>> {
  try {
    return { ok: true, data: await p };
  } catch (err) {
    unstable_rethrow(err);
    const e = err as { message?: string; data?: { errors?: string[] } };
    return { ok: false, erreur: e?.message || String(err), erreurs: Array.isArray(e?.data?.errors) ? e.data.errors : [] };
  }
}

const portee = (providerId: string | null, model: string | null) => ({ provider: providerId, model });

export async function enregistrerPrompt(providerId: string | null, model: string | null, template: string) {
  return tenterPrompt(enregistrerPromptApi({ body: { ...portee(providerId, model), template } }));
}

/* Supprimer la surcharge (template NULL) ; sur le prompt général : retour au défaut du code. */
export async function supprimerPrompt(providerId: string | null, model: string | null) {
  return tenterPrompt(supprimerPromptApi({ body: portee(providerId, model) }));
}

export async function restaurerPrompt(id: string) {
  return tenterPrompt(restaurerPromptApi({ body: { id } }));
}

export async function historiquePrompt(providerId: string | null, model: string | null) {
  return tenterPrompt(historiqueApi({ body: portee(providerId, model) }));
}

export async function apercuPrompt(template: string) {
  return tenterPrompt(apercuApi({ body: { template } }));
}
