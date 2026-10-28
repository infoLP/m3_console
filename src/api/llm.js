/* API de l'onglet LLM du back-office.

   AUCUN handler de ce fichier ne renvoie une clé d'API. Les lectures passent par
   `listProviders` / `readProviderSafe`, qui ne projettent pas la colonne
   chiffrée ; `readProviderWithKey` n'apparaît que dans le test du catalogue, qui
   regarde seulement s'il y a une clé. Les appels sortants (récupération des
   modèles, test de connexion) sont faits par le moteur (T20c).

   Tout est réservé à l'administrateur : c'est le seul rôle qui a `manage_settings`. */

import { send } from "../lib/http.js";
import { can } from "../../shared/model.js";
import { journal } from "../lib/journal.js";
import {
  listProviders, readProviderSafe, readProviderWithKey, saveProvider,
  createProvider, deleteProvider, storeModels, setActiveProviderId, markModelTestsQueued,
  readCurrentPrompts, readPromptHistory, readPromptVersion, insertPrompt, promptKey,
} from "../lib/llmProviders.js";
import { enqueue, attendreJob, lireEtatMoteur } from "../lib/demandes.js";
import { allowlistApplies, isModelAllowedFor } from "../../shared/allowlist.js";
import {
  PROMPT_VARIABLES, REQUIRED_VARIABLES, DEFAULT_TEMPLATE, FORMAT_SORTIE, TEMPLATE_MAX, validateTemplate,
} from "../../shared/promptTemplate.js";

/* T20c : test de connexion, catalogue et aperçu du prompt tournent dans le
   moteur (demandes test_llm, fetch_models, preview_prompt, voie interactive) ;
   la console dépose et attend la réponse, ≤ 45 s. Le moteur relit le moteur
   actif à chaque demande : plus de refreshProvider ici. */
async function demander(kind, params, user) {
  const job = await enqueue(kind, params, user);
  return attendreJob(job.id);
}

function guard(role, res) {
  if (can(role, "manage_settings")) return true;
  send(res, 403, { error: "réservé à l'administrateur" });
  return false;
}

export async function list({ res, role }) {
  if (!guard(role, res)) return;
  send(res, 200, await listProviders());
}

/* Journal (M3-81) : les NOMS des champs touchés, jamais leurs valeurs — une clé
   d'API n'y entre pas, même masquée. On note seulement qu'elle a changé. */
const KEYISH = /key|cle|clé|secret|token/i;
const llmDetail = (body) => ({
  champs: Object.keys(body || {}).filter((k) => !KEYISH.test(k)),
  cle_modifiee: Object.keys(body || {}).some((k) => KEYISH.test(k) && body[k]),
});

export async function create({ res, body, role }) {
  if (!guard(role, res)) return;
  const provider = await createProvider(body || {});
  journal("action", "moteur LLM ajouté", { target: provider?.label || provider?.id || null, detail: llmDetail(body) });
  send(res, 200, { ok: true, provider });
}

export async function save({ res, params, body, role }) {
  if (!guard(role, res)) return;
  const provider = await saveProvider(params[0], body || {});
  journal("action", "moteur LLM modifié", { target: provider?.label || params[0], detail: llmDetail(body) });
  send(res, 200, { ok: true, provider });
}

export async function remove({ res, params, role }) {
  if (!guard(role, res)) return;
  const r = await deleteProvider(params[0]);
  journal("action", "moteur LLM supprimé", { target: params[0] });
  send(res, 200, r);
}

export async function activate({ res, params, role }) {
  if (!guard(role, res)) return;
  await setActiveProviderId(params[0]);
  journal("action", "moteur LLM activé", { target: params[0] });
  send(res, 200, { ok: true, ...(await listProviders()) });
}

/* Alimente la liste de modèles depuis le fournisseur. Le catalogue d'OpenRouter
   est public, les autres exigent la clé — d'où la lecture avec clé, qui ne sort
   pas de cette fonction. */
export async function fetchModels({ res, params, role, user }) {
  if (!guard(role, res)) return;
  const fini = await demander("fetch_models", { provider: params[0] }, user);
  /* Le message du fournisseur est utile (401, quota, URL fausse) ; le moteur
     l'a passé par redact. */
  if (fini.error) return send(res, /inconnu/.test(fini.error) ? 404 : 502, { error: fini.error });
  send(res, 200, { ok: true, count: fini.result?.count ?? 0, provider: await readProviderSafe(params[0]) });
}

/* Test de tout le catalogue, déposé au worker : des centaines d'appels ne
   tiennent pas dans une requête HTTP. La réponse part tout de suite ; l'onglet
   suit la progression dans `modelTests`. La clé n'est lue que pour savoir s'il
   y en a une — sa valeur ne quitte pas cette fonction. */
export async function testModels({ res, params, role, user }) {
  if (!guard(role, res)) return;
  const p = await readProviderWithKey(params[0]);
  if (!p) return send(res, 404, { error: "moteur inconnu" });
  /* Clé d'environnement (OPENROUTER_API_KEY) : connue du moteur seul, qui le dit
     dans moteur/etat (llm.cle). */
  const cleEnv = !p.apiKey && p.id === "openrouter" && (await lireEtatMoteur().catch(() => ({}))).llm?.cle === "environnement";
  if (!p.apiKey && !cleEnv) return send(res, 400, { error: "aucune clé d'API enregistrée pour ce moteur : les modèles ne peuvent pas être testés" });
  const total = (Array.isArray(p.models) ? p.models : []).filter((m) => isModelAllowedFor(p, m)).length;
  if (!total) return send(res, 400, { error: !allowlistApplies(p) || !(p.models || []).length ? "catalogue vide : rien à tester" : "aucun modèle du catalogue n'est sur la liste blanche : rien à tester" });
  const job = await enqueue("test_models", { provider: p.id }, user);
  if (!job.duplicate) await markModelTestsQueued(p.id);
  journal("action", "test des modèles LLM demandé", { target: p.label || p.id, detail: { modeles: total } });
  send(res, 202, { ok: true, total, job: { id: job.id, duplicate: job.duplicate } });
}

/* Test de connexion : un appel minimal, réellement émis par le moteur (demande
   test_llm), dont on ne garde que le verdict. C'est ce qui permet de valider une
   clé sans jamais l'afficher ni la sortir de la base. Les refus (moteur
   inconnu, sans clé, sans modèle, hors liste blanche) reviennent du moteur. */
export async function test({ res, params, role, user }) {
  if (!guard(role, res)) return;
  const fini = await demander("test_llm", { provider: params[0] }, user);
  if (fini.error) return send(res, /inconnu/.test(fini.error) ? 404 : 400, { error: fini.error });
  send(res, 200, fini.result);
}

/* ------------------------------------------------- prompts de génération */

/* Prompts de génération (M3-56) : un prompt général, et des surcharges par
   moteur ou par modèle, historisés (table llm_prompts, ajout seul). Le texte
   est validé ICI, côté serveur, quelle que soit la validation de l'écran :
   liste fermée de variables, variables indispensables, format de sortie
   verrouillé (shared/promptTemplate.js). */

/* Libellé de la portée, pour le journal. */
const portee = ({ providerId, model }) => (!providerId ? "prompt général" : model ? `${providerId} · ${model}` : `${providerId} (tout le moteur)`);

const auteur = (user) => user?.login || user?.name || null;

/* Après chaque écriture : le processus web relit les prompts (régénération
   d'un article depuis la console) ; le worker les relit à chaque run. */
async function afterPromptWrite(res, row, event) {
  journal("action", event, {
    target: portee(row),
    detail: { version_id: row.id, surcharge_supprimee: row.template == null, signes: row.template == null ? 0 : row.template.length },
  });
  send(res, 200, { ok: true, prompt: row, history: await readPromptHistory(row.providerId, row.model) });
}

/* Versions courantes + ce qu'il faut à l'écran pour éditer : variables,
   défaut du code, format de sortie verrouillé. */
export async function prompts({ res, role }) {
  if (!guard(role, res)) return;
  send(res, 200, {
    prompts: await readCurrentPrompts(),
    variables: PROMPT_VARIABLES.map((v) => ({ ...v, requise: REQUIRED_VARIABLES.includes(v.nom) })),
    required: REQUIRED_VARIABLES,
    defaultTemplate: DEFAULT_TEMPLATE,
    outputFormat: FORMAT_SORTIE.replace(/^\s+/, ""),
    maxLength: TEMPLATE_MAX,
  });
}

/* Historique d'une portée : body { provider, model } (null/absents = général). */
export async function promptHistory({ res, body, role }) {
  if (!guard(role, res)) return;
  const k = promptKey(body?.provider, body?.model);
  send(res, 200, { ...k, history: await readPromptHistory(k.providerId, k.model) });
}

/* Enregistre une nouvelle version : body { provider, model, template }.
   Refus 400 avec la liste des erreurs (`errors`) si le texte ne passe pas. */
export async function savePrompt({ res, body, role, user }) {
  if (!guard(role, res)) return;
  const k = promptKey(body?.provider, body?.model);
  const template = body?.template;
  const errors = validateTemplate(template);
  if (errors.length) return send(res, 400, { error: `prompt refusé : ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1})` : ""}`, errors });
  const row = await insertPrompt({ ...k, template, createdBy: auteur(user) });
  await afterPromptWrite(res, row, "prompt de génération enregistré");
}

/* Revenir à une version = en insérer une COPIE (l'historique ne se réécrit
   pas) : body { id }. Une ancienne version qui ne passe plus la validation
   actuelle (variable retirée depuis) est refusée comme un enregistrement. */
export async function restorePrompt({ res, body, role, user }) {
  if (!guard(role, res)) return;
  const v = await readPromptVersion(body?.id);
  if (!v) return send(res, 404, { error: "version inconnue" });
  if (v.template != null) {
    const errors = validateTemplate(v.template);
    if (errors.length) return send(res, 400, { error: `cette version ne passe plus la validation : ${errors[0]}`, errors });
  }
  const row = await insertPrompt({ providerId: v.providerId, model: v.model, template: v.template, createdBy: auteur(user) });
  await afterPromptWrite(res, row, "prompt de génération restauré");
}

/* Supprimer une surcharge = insérer NULL : le niveau supérieur s'applique.
   Sur le prompt général, c'est le retour au prompt par défaut du code. */
export async function removePrompt({ res, body, role, user }) {
  if (!guard(role, res)) return;
  const k = promptKey(body?.provider, body?.model);
  const row = await insertPrompt({ ...k, template: null, createdBy: auteur(user) });
  await afterPromptWrite(res, row, k.providerId ? "surcharge de prompt supprimée" : "prompt général remis au défaut du code");
}

/* Aperçu : le texte qu'un moteur recevrait pour un article d'exemple, avec
   les réglages actuels — format de sortie compris. Aucun appel au LLM, rien
   d'écrit. Rendu même si le modèle a des erreurs, qui sont rendues à côté. */
export async function previewPrompt({ res, body, role, user }) {
  if (!guard(role, res)) return;
  const template = typeof body?.template === "string" ? body.template : DEFAULT_TEMPLATE;
  const fini = await demander("preview_prompt", { template }, user);
  if (fini.error) return send(res, 502, { error: fini.error });
  send(res, 200, fini.result);
}
