/* M3-53 — Rubriques et mots-clés : l'API WordPress attend des IDENTIFIANTS
   numériques de termes, M3 manipule des libellés (« Économie », « hydrogène »).

   - Rubrique (category) : structure éditoriale du site, posée par son
     administrateur. Absente → erreur qui la nomme, sauf réglage
     `wp_create_categories` : publier dans « Non classé » serait pire qu'échouer.
   - Mot-clé (tag) : absent → créé. Si un autre envoi l'a créé entre-temps,
     WordPress répond `term_exists` avec l'identifiant, qu'on reprend.

   Comparaison des libellés : WordPress renvoie les noms échappés en HTML
   (« &amp; ») ; casse et espaces ne comptent pas, les accents si (« Pêche » et
   « Peche » sont deux termes distincts pour WordPress aussi). */

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'", "&#8217;": "’", "&rsquo;": "’" };
const decode = (s) => String(s ?? "").replace(/&(amp|lt|gt|quot|#039|#8217|rsquo);/g, (m) => ENTITIES[m] || m);
export const sameLabel = (a, b) =>
  decode(a).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase() === decode(b).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

const uniq = (list) => {
  const out = [];
  for (const x of list || []) {
    if (x === null || x === undefined || x === "") continue;
    if (!out.some((y) => (typeof x === "number" ? x === y : typeof y !== "number" && sameLabel(x, y)))) out.push(x);
  }
  return out;
};

async function findTerm(client, taxonomy, label) {
  const found = await client.get(`/wp/v2/${taxonomy}?search=${encodeURIComponent(label)}&per_page=100&_fields=id,name,slug`);
  return (found || []).find((t) => sameLabel(t.name, label) || t.slug === label) || null;
}

async function createTerm(client, taxonomy, label) {
  try {
    const t = await client.post(`/wp/v2/${taxonomy}`, { name: label });
    return t.id;
  } catch (e) {
    const id = e?.data?.term_id;
    if (e?.code === "term_exists" && id) return Number(id);
    throw e;
  }
}

/* Renvoie { categories: [ids], tags: [ids], created: { categories: [...], tags: [...] } }. */
export async function resolveTerms(client, { categories = [], tags = [] } = {}, { createCategories = false } = {}) {
  const created = { categories: [], tags: [] };
  const missing = [];

  async function resolve(taxonomy, labels, create, createdList) {
    const ids = [];
    for (const label of uniq(labels)) {
      if (typeof label === "number") { ids.push(label); continue; }
      const t = await findTerm(client, taxonomy, label);
      if (t) { ids.push(t.id); continue; }
      if (!create) { missing.push(label); continue; }
      ids.push(await createTerm(client, taxonomy, label));
      createdList.push(label);
    }
    return [...new Set(ids)];
  }

  const catIds = await resolve("categories", categories, createCategories, created.categories);
  if (missing.length) {
    throw new Error(
      `Rubrique absente du site WordPress : ${missing.map((m) => `« ${m} »`).join(", ")}. ` +
      "La créer côté WordPress, ou autoriser M3 à le faire (M3_WP_CREATE_CATEGORIES=oui)."
    );
  }
  const tagIds = await resolve("tags", tags, true, created.tags);
  return { categories: catIds, tags: tagIds, created };
}
