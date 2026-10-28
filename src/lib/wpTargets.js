/* M3-53 — Cibles de publication WordPress : les sites sur lesquels M3 peut
   envoyer un article, gérés par l'administrateur (onglet Publication).

   Même forme que les moteurs LLM : le mot de passe d'application est CHIFFRÉ en
   base (secretBox, M3_SECRET_KEY) et ne sort jamais, ni vers l'écran ni dans
   une réponse d'API : seule son empreinte (`secretHint`) est affichée. M2 gère
   ses cibles de la même façon (M2_Console, écran Cibles).

   Le service est écrit contre un « dépôt » (repo) : `pgRepo` en production, un
   dépôt en mémoire dans les tests (test/wpTargets.test.js). */

import { query as pgQuery, withTransaction } from "./db.js";
import { encryptSecret, decryptSecret, secretsAvailable, MISSING_SECRET } from "./secretBox.js";
import { SEO_PLUGIN_IDS } from "../../shared/seoPlugins.js";

export const PUBLISH_STATUSES = ["draft", "publish"];
export const NAME_MAX = 80;
export const PASSWORD_MIN = 8;

const fail = (status, message) => Object.assign(new Error(message), { status });

/* ---------------------------------------------------------- validation */

/* Une adresse de site : http(s), sans identifiants ni paramètres, sans « / » final. */
export function normalizeUrl(brut) {
  let u;
  try { u = new URL(String(brut ?? "").trim()); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

const yes = (v) => v === true || v === "on" || v === "true" || v === "oui";

/* Valide une saisie de formulaire. `creating` : le mot de passe est alors
   obligatoire ; à la modification, vide = on garde l'ancien. */
export function validateTarget(input = {}, { creating = false } = {}) {
  const name = String(input.name ?? "").trim();
  if (name.length < 2) return { error: "Nom trop court (2 caractères au moins)." };
  if (name.length > NAME_MAX) return { error: `Nom trop long (${NAME_MAX} caractères au plus).` };
  const url = normalizeUrl(input.url);
  if (!url) return { error: "Adresse invalide : http:// ou https://, sans identifiant ni paramètre." };
  const wpUser = String(input.wpUser ?? "").trim();
  if (!wpUser) return { error: "Compte WordPress requis." };
  const password = String(input.password ?? "").trim();
  if (creating && !password) return { error: "Mot de passe d'application requis." };
  if (password && password.length < PASSWORD_MIN) return { error: `Mot de passe d'application trop court (${PASSWORD_MIN} caractères au moins).` };
  const seoPlugin = String(input.seoPlugin ?? "none");
  if (!SEO_PLUGIN_IDS.includes(seoPlugin)) return { error: `Greffon SEO inconnu : ${seoPlugin}.` };
  const publishStatus = String(input.publishStatus ?? "draft");
  if (!PUBLISH_STATUSES.includes(publishStatus)) return { error: `Statut d'arrivée inconnu : ${publishStatus}.` };
  return {
    value: {
      name, url, wpUser, password: password || null, seoPlugin, publishStatus,
      createCategories: yes(input.createCategories),
      isDefault: yes(input.isDefault),
    },
  };
}

/* La ligne telle que l'écran la reçoit : jamais le secret, ni chiffré ni clair. */
export function toPublic(row) {
  return {
    id: Number(row.id),
    name: row.name,
    url: row.url,
    wpUser: row.wp_user,
    secretHint: row.secret_hint || "",
    seoPlugin: row.seo_plugin,
    createCategories: !!row.create_categories,
    publishStatus: row.publish_status,
    isDefault: !!row.is_default,
    active: !!row.active,
    createdBy: row.created_by || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

/* ------------------------------------------------------------- service */

/* Empreinte affichable d'un mot de passe d'application : les 4 derniers caractères
   seulement. hintOf() des clés d'API en montre 9 ; sur un mot de passe de 24
   caractères, c'est trop. */
export const hintOfAppPassword = (plain) => {
  const compact = String(plain || "").replace(/s+/g, "");
  return compact.length < 8 ? "…" : `…${compact.slice(-4)}`;
};

export function createWpTargets({ repo = pgRepo(), crypto = { encrypt: encryptSecret, decrypt: decryptSecret, hint: hintOfAppPassword, available: secretsAvailable } } = {}) {
  const must = (row, id) => {
    if (!row) throw fail(404, `cible inconnue : ${id}`);
    return row;
  };

  return {
    async list() {
      return (await repo.all()).map(toPublic);
    },

    async get(id) {
      return toPublic(must(await repo.byId(id), id));
    },

    /* La cible à utiliser pour une publication : celle qu'on demande (active),
       sinon la cible par défaut, sinon l'unique cible active. Rend les
       identifiants EN CLAIR, pour le seul usage de wordpress.js : l'appelant ne
       doit ni les journaliser ni les renvoyer. */
    async resolveForPublish(id = null) {
      const rows = await repo.all();
      const actives = rows.filter((r) => r.active);
      let row = null;
      if (id != null && id !== "") {
        row = rows.find((r) => Number(r.id) === Number(id));
        if (!row) throw fail(404, `cible inconnue : ${id}`);
        if (!row.active) throw fail(409, `la cible « ${row.name} » est désactivée`);
      } else {
        row = actives.find((r) => r.is_default) || (actives.length === 1 ? actives[0] : null);
      }
      if (!row) return null;
      const appPassword = crypto.decrypt(row.secret_enc);
      if (!appPassword) {
        throw fail(503, crypto.available()
          ? `Le mot de passe de la cible « ${row.name} » est illisible (M3_SECRET_KEY changée ?) : le ressaisir dans l'onglet Publication.`
          : MISSING_SECRET);
      }
      return {
        id: Number(row.id), name: row.name, url: row.url, user: row.wp_user, appPassword,
        seoPlugin: row.seo_plugin, createCategories: !!row.create_categories, publishStatus: row.publish_status,
      };
    },

    async create(input, { by = null } = {}) {
      const v = validateTarget(input, { creating: true });
      if (v.error) throw fail(400, v.error);
      if (!crypto.available()) throw fail(503, MISSING_SECRET);
      const { password, isDefault, ...rest } = v.value;
      const first = (await repo.all()).length === 0;
      try {
        const row = await repo.insert({
          ...rest, secretEnc: crypto.encrypt(password), secretHint: crypto.hint(password), createdBy: by,
        }, { makeDefault: isDefault || first });
        return toPublic(row);
      } catch (e) {
        throw uniqueName(e, rest.name);
      }
    },

    async update(id, input) {
      const existing = must(await repo.byId(id), id);
      const v = validateTarget(input, { creating: false });
      if (v.error) throw fail(400, v.error);
      const { password, isDefault, ...rest } = v.value;
      if (isDefault && !existing.active) throw fail(409, "Une cible désactivée ne peut pas être la cible par défaut.");
      if (password && !crypto.available()) throw fail(503, MISSING_SECRET);
      try {
        const row = await repo.update(id, {
          ...rest,
          ...(password ? { secretEnc: crypto.encrypt(password), secretHint: crypto.hint(password) } : {}),
        }, { makeDefault: isDefault });
        return toPublic(must(row, id));
      } catch (e) {
        throw uniqueName(e, rest.name);
      }
    },

    /* Désactiver une cible la retire des choix et lui ôte le statut « par
       défaut » : une cible désactivée ne doit jamais être choisie sans le dire. */
    async setActive(id, active) {
      must(await repo.byId(id), id);
      return toPublic(must(await repo.setActive(id, !!active), id));
    },

    /* Suppression : seulement une cible déjà désactivée, comme un compte. Les
       publications passées gardent l'adresse du site en clair. */
    async remove(id) {
      const row = must(await repo.byId(id), id);
      if (row.active) throw fail(409, `Désactivez d'abord la cible « ${row.name} » avant de la supprimer.`);
      await repo.remove(id);
      return { id: Number(id), name: row.name };
    },

    /* Identifiants d'une cible enregistrée, pour « Tester la connexion ». */
    async credentials(id) {
      const row = must(await repo.byId(id), id);
      const appPassword = crypto.decrypt(row.secret_enc);
      if (!appPassword) throw fail(503, crypto.available() ? "Mot de passe illisible : le ressaisir." : MISSING_SECRET);
      return { url: row.url, user: row.wp_user, appPassword, name: row.name };
    },
  };
}

function uniqueName(e, name) {
  if (e?.code === "23505" && String(e.constraint || "").includes("name")) return fail(409, `Une cible nommée « ${name} » existe déjà.`);
  return e;
}

/* --------------------------------------------------------------- dépôt */

const ORDER = "ORDER BY active DESC, is_default DESC, lower(name)";

export function pgRepo(query = pgQuery) {
  return {
    async all() {
      return (await query(`SELECT * FROM wp_targets ${ORDER}`)).rows;
    },
    async byId(id) {
      return (await query("SELECT * FROM wp_targets WHERE id = $1", [id])).rows[0] || null;
    },
    /* Une seule cible par défaut : l'ancienne perd le statut dans la même
       transaction, sans quoi l'index unique refuserait la nouvelle. */
    async insert(f, { makeDefault }) {
      return withTransaction(async (c) => {
        if (makeDefault) await c.query("UPDATE wp_targets SET is_default = false WHERE is_default");
        const { rows } = await c.query(
          `INSERT INTO wp_targets (name, url, wp_user, secret_enc, secret_hint, seo_plugin, create_categories, publish_status, is_default, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [f.name, f.url, f.wpUser, f.secretEnc, f.secretHint, f.seoPlugin, f.createCategories, f.publishStatus, !!makeDefault, f.createdBy]
        );
        return rows[0];
      });
    },
    async update(id, f, { makeDefault }) {
      return withTransaction(async (c) => {
        if (makeDefault) await c.query("UPDATE wp_targets SET is_default = false WHERE is_default AND id <> $1", [id]);
        const { rows } = await c.query(
          `UPDATE wp_targets SET name = $2, url = $3, wp_user = $4,
                  secret_enc = COALESCE($5, secret_enc), secret_hint = COALESCE($6, secret_hint),
                  seo_plugin = $7, create_categories = $8, publish_status = $9,
                  is_default = CASE WHEN $10 THEN true WHEN NOT active THEN false ELSE is_default END,
                  updated_at = now()
            WHERE id = $1 RETURNING *`,
          [id, f.name, f.url, f.wpUser, f.secretEnc ?? null, f.secretHint ?? null, f.seoPlugin, f.createCategories, f.publishStatus, !!makeDefault]
        );
        return rows[0] || null;
      });
    },
    async setActive(id, active) {
      const { rows } = await query(
        `UPDATE wp_targets SET active = $2, is_default = CASE WHEN $2 THEN is_default ELSE false END, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, active]
      );
      return rows[0] || null;
    },
    async remove(id) {
      await query("DELETE FROM wp_targets WHERE id = $1", [id]);
    },
  };
}
