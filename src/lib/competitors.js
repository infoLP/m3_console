/* M3-120 (lot 1 de M3-119) — Sites concurrents suivis : ceux dont on analysera
   les articles pour y trouver des sources (crawl et extraction : M3-121,
   propositions : M3-122). Gérés au back-office, onglet Sources → Concurrents,
   par l'administrateur et le superutilisateur (droit `manage_competitors`).
   Même forme que src/lib/wpTargets.js : le service est écrit contre un « dépôt »
   (repo), `pgRepo` en production (table `competitors`, migration 020), un dépôt
   en mémoire dans les tests (test/concurrents.test.js). */

import { query as pgQuery } from "./db.js";

export const LABEL_MAX = 80;

const fail = (status, message) => Object.assign(new Error(message), { status });

/* ---------------------------------------------------------- validation */

/* Une adresse de site : http(s), sans identifiants ni paramètres ni fragment,
   sans « / » final. L'hôte sort en minuscules (URL le fait), le chemin est gardé
   tel quel : deux rubriques d'un même site peuvent être suivies à part. */
export function normalizeUrl(brut) {
  let u;
  try { u = new URL(String(brut ?? "").trim()); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

export function validateCompetitor(input = {}) {
  const label = String(input.label ?? "").trim();
  if (label.length < 2) return { error: "Libellé trop court (2 caractères au moins)." };
  if (label.length > LABEL_MAX) return { error: `Libellé trop long (${LABEL_MAX} caractères au plus).` };
  const url = normalizeUrl(input.url);
  if (!url) return { error: "Adresse invalide : http:// ou https://, sans identifiant, paramètre ni ancre." };
  return { value: { label, url } };
}

export function toPublic(row) {
  const iso = (d) => (d instanceof Date ? d.toISOString() : d);
  return {
    id: Number(row.id),
    label: row.label,
    url: row.url,
    active: !!row.active,
    createdBy: row.created_by || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    /* Dernier passage du scan (M3-121, colonnes last_scan_* de la migration 021) :
       null tant que le concurrent n'a jamais été scanné. */
    lastScan: row.last_scan_at
      ? { at: iso(row.last_scan_at), status: row.last_scan_status || null, via: row.last_scan_via || null, error: row.last_scan_error || null }
      : null,
  };
}

/* ------------------------------------------------------------- service */

export function createCompetitors({ repo = pgRepo() } = {}) {
  const must = (row, id) => {
    if (!row) throw fail(404, `concurrent inconnu : ${id}`);
    return row;
  };
  /* Doublon vérifié avant l'écriture pour un message clair ; l'index unique de
     la table (lower(url)) tranche si deux saisies se croisent. */
  const sansDoublon = async (url, saufId = null) => {
    const autre = (await repo.all()).find((r) => r.url.toLowerCase() === url.toLowerCase() && Number(r.id) !== Number(saufId));
    if (autre) throw fail(409, `Ce site est déjà suivi : « ${autre.label} ».`);
  };
  const doublon = (e, url) => (e?.code === "23505" ? fail(409, `Ce site est déjà suivi (${url}).`) : e);

  return {
    async list() {
      return (await repo.all()).map(toPublic);
    },

    async create(input, { by = null } = {}) {
      const v = validateCompetitor(input);
      if (v.error) throw fail(400, v.error);
      await sansDoublon(v.value.url);
      try {
        return toPublic(await repo.insert({ ...v.value, createdBy: by }));
      } catch (e) {
        throw doublon(e, v.value.url);
      }
    },

    async update(id, input) {
      must(await repo.byId(id), id);
      const v = validateCompetitor(input);
      if (v.error) throw fail(400, v.error);
      await sansDoublon(v.value.url, id);
      try {
        return toPublic(must(await repo.update(id, v.value), id));
      } catch (e) {
        throw doublon(e, v.value.url);
      }
    },

    /* Désactiver : le site reste dans la liste mais ne sera plus crawlé (M3-121). */
    async setActive(id, active) {
      must(await repo.byId(id), id);
      return toPublic(must(await repo.setActive(id, !!active), id));
    },

    async remove(id) {
      const row = must(await repo.byId(id), id);
      await repo.remove(id);
      return { id: Number(id), label: row.label, url: row.url };
    },
  };
}

/* --------------------------------------------------------------- dépôt */

export function pgRepo(query = pgQuery) {
  return {
    async all() {
      return (await query("SELECT * FROM competitors ORDER BY active DESC, lower(label)")).rows;
    },
    async byId(id) {
      return (await query("SELECT * FROM competitors WHERE id = $1", [id])).rows[0] || null;
    },
    async insert(f) {
      const { rows } = await query(
        "INSERT INTO competitors (label, url, created_by) VALUES ($1, $2, $3) RETURNING *",
        [f.label, f.url, f.createdBy]
      );
      return rows[0];
    },
    async update(id, f) {
      const { rows } = await query(
        "UPDATE competitors SET label = $2, url = $3, updated_at = now() WHERE id = $1 RETURNING *",
        [id, f.label, f.url]
      );
      return rows[0] || null;
    },
    async setActive(id, active) {
      const { rows } = await query(
        "UPDATE competitors SET active = $2, updated_at = now() WHERE id = $1 RETURNING *",
        [id, active]
      );
      return rows[0] || null;
    },
    async remove(id) {
      await query("DELETE FROM competitors WHERE id = $1", [id]);
    },
  };
}
