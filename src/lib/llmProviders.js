/* Registre des moteurs LLM configurés au back-office.

   RÈGLE CENTRALE DE CE MODULE : deux portes de lecture, et une seule laisse
   sortir la clé.

   - `listProviders()` / `readProviderSafe()` — ce que voit l'API, donc le
     navigateur. La clé n'y est pas : seulement `hasKey` et l'empreinte.
   - `activeProvider()` / `readProviderWithKey()` — réservé à la couche LLM, qui
     en a besoin pour signer l'appel sortant.

   Aucun handler d'API ne doit appeler la seconde famille pour répondre : c'est
   par là qu'une clé finirait dans une réponse JSON. */

import { query, withTransaction } from "./db.js";
import { encryptSecret, decryptSecret, hintOf, secretsAvailable, MISSING_SECRET } from "./secretBox.js";
import {
  ALLOWED_MODELS, allowlistApplies, isModelAllowed, isModelAllowedFor, isModelSavable, notAllowed,
} from "../../shared/allowlist.js";

/* Le moteur actif est désigné par un réglage. Il vit dans `settings` comme les
   autres, mais volontairement HORS de SETTING_SPECS : l'onglet LLM en est le
   seul éditeur, l'exposer aussi dans le tableau « Paramètres » donnerait deux
   champs pour une même valeur, dont l'un sans validation. */
export const ACTIVE_KEY = "llm_provider";

export const PROVIDER_KINDS = {
  openai: "Compatible OpenAI",
  anthropic: "Anthropic",
};

const COLUMNS = `id, label, kind, base_url AS "baseUrl", api_key_hint AS "keyHint",
                 (api_key_enc IS NOT NULL) AS "hasKey",
                 models, models_fetched_at AS "modelsFetchedAt",
                 fetch_models AS "fetchModels", default_model AS "defaultModel",
                 enabled, position, model_tests AS "modelTests"`;

export async function activeProviderId() {
  const { rows } = await query("SELECT value FROM settings WHERE key = $1", [ACTIVE_KEY]);
  return rows[0]?.value || null;
}

export async function setActiveProviderId(id) {
  const { rows } = await query("SELECT enabled FROM llm_providers WHERE id = $1", [id]);
  if (!rows.length) throw Object.assign(new Error(`moteur inconnu : ${id}`), { status: 400 });
  if (!rows[0].enabled) throw Object.assign(new Error("ce moteur est désactivé"), { status: 400 });
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [ACTIVE_KEY, id]
  );
  return id;
}

/* Liste destinée à l'affichage. Sûre par construction : `COLUMNS` ne projette
   pas `api_key_enc`. */
export async function listProviders() {
  const [{ rows }, active] = await Promise.all([
    query(`SELECT ${COLUMNS} FROM llm_providers ORDER BY position, id`),
    activeProviderId(),
  ]);
  return {
    /* `modelAllowed` : sans lui, le bandeau du back-office annoncerait
       « Génération par … » pour un moteur dont chaque appel est refusé (M3-63). */
    /* `allowlist` : la liste blanche s'applique-t-elle à ce moteur ? Non pour
       OpenRouter, dont les guardrails font foi (M3-68) ; le back-office lui
       propose alors tout le catalogue. */
    providers: rows.map((r) => ({
      ...r,
      active: r.id === active,
      allowlist: allowlistApplies(r),
      modelAllowed: isModelAllowedFor(r, r.defaultModel),
    })),
    activeId: active,
    allowedModels: ALLOWED_MODELS,
    /* Le navigateur doit pouvoir expliquer pourquoi l'enregistrement d'une clé
       échoue, plutôt que d'afficher une erreur brute au moment du clic. */
    secretsAvailable: secretsAvailable(),
    kinds: PROVIDER_KINDS,
  };
}

export async function readProviderSafe(id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM llm_providers WHERE id = $1`, [id]);
  return rows[0] || null;
}

/* ------------------------------------------------------------------ secrets */

/* Seule fonction du projet qui rend une clé en clair. Réservée à la couche LLM
   et au test de connexion. */
export async function readProviderWithKey(id) {
  const { rows } = await query(
    `SELECT ${COLUMNS}, api_key_enc AS "keyEnc" FROM llm_providers WHERE id = $1`, [id]);
  const p = rows[0];
  if (!p) return null;
  const { keyEnc, ...rest } = p;
  return { ...rest, apiKey: decryptSecret(keyEnc) };
}

export async function activeProvider() {
  const id = await activeProviderId();
  if (!id) return null;
  const p = await readProviderWithKey(id);
  return p && p.enabled ? p : null;
}

/* --------------------------------------------------------------------- CRUD */

const TEXT_FIELDS = { label: "label", baseUrl: "base_url", defaultModel: "default_model" };
const BOOL_FIELDS = { fetchModels: "fetch_models", enabled: "enabled" };

/* Liste blanche (M3-63) à l'enregistrement : on refuse un modèle hors liste
   qu'on est en train de CHOISIR, pas celui qui est déjà en base. Le formulaire
   renvoie tous ses champs à chaque enregistrement ; refuser la valeur inchangée
   empêcherait, sur un moteur réglé avant la liste blanche, de retirer une clé
   ou de renommer le moteur. Ce modèle hérité n'en passe pas pour autant : chaque
   appel est contrôlé dans src/llm/index.js — refusé, sauf sur un moteur exempté
   (OpenRouter, M3-68) — et le back-office le signale.

   La lecture n'a lieu que pour une valeur hors liste — le cas normal ne coûte
   aucune requête. */
export async function saveProvider(id, patch = {}) {
  const sets = [];
  const params = [id];
  const add = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`); };

  for (const [k, col] of Object.entries(TEXT_FIELDS)) {
    if (patch[k] === undefined) continue;
    const v = patch[k] === null ? null : String(patch[k]).trim();
    if (col === "base_url" && !v) throw Object.assign(new Error("l'URL de base est obligatoire"), { status: 400 });
    /* Règle complète, exemption d'OpenRouter comprise (M3-68) : isModelSavable. */
    if (col === "default_model" && v && !isModelAllowed(v) && !isModelSavable(patch, await readProviderSafe(id))) {
      throw notAllowed(v, "enregistrement refusé, y ajouter un modèle demande un commit");
    }
    add(col, v || null);
  }
  for (const [k, col] of Object.entries(BOOL_FIELDS)) {
    if (patch[k] !== undefined) add(col, !!patch[k]);
  }
  if (patch.models !== undefined) {
    if (!Array.isArray(patch.models)) throw Object.assign(new Error("`models` attend un tableau"), { status: 400 });
    add("models", JSON.stringify(patch.models.map(String)));
  }

  /* La clé ne se modifie que par remplacement explicite : un formulaire renvoyé
     sans le champ (le cas normal, puisqu'on ne la lui a jamais donnée) ne doit
     surtout pas l'effacer. `clearKey` est le seul chemin de suppression. */
  if (patch.clearKey) {
    add("api_key_enc", null);
    add("api_key_hint", null);
  } else if (patch.apiKey) {
    const plain = String(patch.apiKey).trim();
    if (!secretsAvailable()) throw Object.assign(new Error(MISSING_SECRET), { status: 503 });
    if (plain.length < 8) throw Object.assign(new Error("clé trop courte"), { status: 400 });
    add("api_key_enc", encryptSecret(plain));
    add("api_key_hint", hintOf(plain));
  }

  if (!sets.length) return readProviderSafe(id);
  sets.push("updated_at = now()");
  const { rowCount } = await query(
    `UPDATE llm_providers SET ${sets.join(", ")} WHERE id = $1`, params);
  if (!rowCount) throw Object.assign(new Error(`moteur inconnu : ${id}`), { status: 404 });

  /* Désactiver le moteur actif laisserait la génération sans moteur : on
     bascule sur le premier moteur actif restant, ou sur aucun (→ mock). */
  if (patch.enabled === false && (await activeProviderId()) === id) {
    const { rows } = await query(
      "SELECT id FROM llm_providers WHERE enabled AND id <> $1 ORDER BY position, id LIMIT 1", [id]);
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [ACTIVE_KEY, rows[0]?.id || ""]
    );
  }
  return readProviderSafe(id);
}

export async function createProvider({ id, label, kind, baseUrl }) {
  const slug = String(id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!slug) throw Object.assign(new Error("identifiant invalide"), { status: 400 });
  if (!PROVIDER_KINDS[kind]) throw Object.assign(new Error("protocole inconnu"), { status: 400 });
  if (!String(baseUrl || "").trim()) throw Object.assign(new Error("l'URL de base est obligatoire"), { status: 400 });
  const { rowCount } = await query(
    `INSERT INTO llm_providers (id, label, kind, base_url, position)
     VALUES ($1, $2, $3, $4, (SELECT coalesce(max(position), 0) + 1 FROM llm_providers))
     ON CONFLICT (id) DO NOTHING`,
    [slug, String(label || slug).trim(), kind, String(baseUrl).trim()]
  );
  if (!rowCount) throw Object.assign(new Error(`le moteur « ${slug} » existe déjà`), { status: 409 });
  return readProviderSafe(slug);
}

export async function deleteProvider(id) {
  return withTransaction(async (c) => {
    const { rowCount } = await c.query("DELETE FROM llm_providers WHERE id = $1", [id]);
    if (!rowCount) throw Object.assign(new Error(`moteur inconnu : ${id}`), { status: 404 });
    const { rows } = await c.query("SELECT value FROM settings WHERE key = $1", [ACTIVE_KEY]);
    if (rows[0]?.value === id) {
      const { rows: next } = await c.query(
        "SELECT id FROM llm_providers WHERE enabled ORDER BY position, id LIMIT 1");
      await c.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [ACTIVE_KEY, next[0]?.id || ""]
      );
    }
    return { ok: true, removed: id };
  });
}

export async function storeModels(id, models) {
  const list = [...new Set(models.map(String))].sort();
  await query(
    "UPDATE llm_providers SET models = $2::jsonb, models_fetched_at = now(), updated_at = now() WHERE id = $1",
    [id, JSON.stringify(list)]
  );
  return list;
}

/* Test des modèles (migration 015, src/llm/modelTests.js). Un document par
   moteur, remis à zéro à chaque test : tout est retesté à chaque clic. Les
   verdicts s'y rangent un par un, pour que l'onglet suive la progression. */
/* Posé au dépôt de la demande : l'onglet affiche « en attente du worker » sans
   attendre qu'il la prenne (une récolte en cours passe avant). */
export async function markModelTestsQueued(id) {
  await query(
    "UPDATE llm_providers SET model_tests = model_tests || jsonb_build_object('queuedAt', $2::text) WHERE id = $1",
    [id, new Date().toISOString()]
  );
}

export async function startModelTests(id, total) {
  await query(
    "UPDATE llm_providers SET model_tests = $2::jsonb WHERE id = $1",
    [id, JSON.stringify({ startedAt: new Date().toISOString(), finishedAt: null, total, stopped: null, results: {} })]
  );
}

export async function recordModelVerdict(id, model, verdict) {
  await query(
    "UPDATE llm_providers SET model_tests = jsonb_set(model_tests, ARRAY['results', $2::text], $3::jsonb, true) WHERE id = $1",
    [id, model, JSON.stringify(verdict)]
  );
}

export async function finishModelTests(id, stopped = null) {
  await query(
    "UPDATE llm_providers SET model_tests = model_tests || jsonb_build_object('finishedAt', $2::text, 'stopped', $3::text) WHERE id = $1",
    [id, new Date().toISOString(), stopped]
  );
}

/* ------------------------------------------------- prompts de génération */

/* Prompts de génération modifiables au back-office (M3-56) — table
   `llm_prompts`, migration 017. AJOUT SEUL : chaque enregistrement, retour à
   une version ou suppression de surcharge est une ligne de plus, jamais une
   mise à jour ; l'historique est la table elle-même.
   - provider_id NULL = prompt général ; model NULL = tout le moteur ;
   - template NULL = surcharge supprimée (retour au niveau supérieur ; pour le
     prompt général, retour au défaut du code) ;
   - version courante d'un couple (provider_id, model) = sa dernière ligne, triée
     par « created_at DESC, id DESC » : now() est figé dans une transaction, deux
     lignes peuvent avoir le même created_at, l'id les départage.
   `version` : rang de la ligne dans l'historique de son couple, 1 = la première.
   PARTITION BY regroupe les NULL entre eux, ce qu'il faut ici. */
const PROMPT_COLUMNS = `id::text AS id, provider_id AS "providerId", model, template,
                        created_at AS "createdAt", created_by AS "createdBy"`;

const promptRow = (r) => (r ? { ...r, version: r.version == null ? null : Number(r.version) } : null);

/* `''` et espaces = NULL : un formulaire ne distingue pas « vide » de « aucun ». */
export function promptKey(providerId, model) {
  const p = String(providerId ?? "").trim() || null;
  const m = String(model ?? "").trim() || null;
  if (m && !p) throw Object.assign(new Error("une surcharge par modèle doit nommer son moteur"), { status: 400 });
  return { providerId: p, model: m };
}

/* Version courante de chaque couple, surcharges supprimées comprises (template
   NULL) : c'est ce que lit la génération (src/llm/index.js) et l'écran. */
export async function readCurrentPrompts() {
  const { rows } = await query(
    `SELECT ${PROMPT_COLUMNS}, version FROM (
       SELECT *, row_number() OVER w_desc AS rn, count(*) OVER w_all AS version
         FROM llm_prompts
       WINDOW w_desc AS (PARTITION BY provider_id, model ORDER BY created_at DESC, id DESC),
              w_all AS (PARTITION BY provider_id, model)
     ) t WHERE rn = 1
     ORDER BY provider_id NULLS FIRST, model NULLS FIRST`);
  return rows.map(promptRow);
}

/* Historique d'un couple, du plus récent au plus ancien. */
export async function readPromptHistory(providerId, model) {
  const k = promptKey(providerId, model);
  const { rows } = await query(
    `SELECT ${PROMPT_COLUMNS}, row_number() OVER (ORDER BY created_at, id) AS version
       FROM llm_prompts
      WHERE provider_id IS NOT DISTINCT FROM $1 AND model IS NOT DISTINCT FROM $2
      ORDER BY created_at DESC, id DESC`,
    [k.providerId, k.model]);
  return rows.map(promptRow);
}

export async function readPromptVersion(id) {
  if (!/^\d+$/.test(String(id ?? ""))) throw Object.assign(new Error("version inconnue"), { status: 400 });
  const { rows } = await query(`SELECT ${PROMPT_COLUMNS} FROM llm_prompts WHERE id = $1`, [String(id)]);
  return promptRow(rows[0]);
}

/* Ajoute une version. La validation du texte (validateTemplate) est faite par
   l'appelant : ce module ne connaît que le stockage. Moteur inconnu : la clé
   étrangère refuse (23503), traduit en 400. */
export async function insertPrompt({ providerId, model, template, createdBy = null }) {
  const k = promptKey(providerId, model);
  try {
    const { rows } = await query(
      `INSERT INTO llm_prompts (provider_id, model, template, created_by)
       VALUES ($1, $2, $3, $4) RETURNING ${PROMPT_COLUMNS}`,
      [k.providerId, k.model, template == null ? null : String(template), createdBy]);
    return promptRow(rows[0]);
  } catch (err) {
    if (err.code === "23503") throw Object.assign(new Error(`moteur inconnu : ${k.providerId}`), { status: 400 });
    throw err;
  }
}
