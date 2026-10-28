/* Regroupement des sources par organisation (M3-59) — partagé backend + navigateur.
   Aucune dépendance DOM.

   Une organisation est l'émetteur : « Mairie de La Rochelle » peut porter le
   magazine municipal, les communiqués et les documents. Ce n'est pas la commune,
   qui est un lieu — La Rochelle compte seize sources de seize organisations.

   Le champ se remplit à la main au back-office ; `suggestOrganisations` propose
   un pré-remplissage par nom de domaine, que l'administrateur relit avant
   d'enregistrer. */

const URL_FIELDS = ["siteUrl", "rssUrl", "listUrl", "pressUrl"];

/* Types de source, dans l'ordre du back-office. */
export const SOURCE_TYPES = ["rss", "article", "site", "pdf", "none"];

/* Champ d'URL d'une source selon son type : l'adresse saisie va dans un seul,
   les autres sont vidés. */
export function setSourceUrl(s, v) {
  URL_FIELDS.forEach((k) => delete s[k]);
  const val = String(v || "").trim();
  if (!val) return;
  const field = { rss: "rssUrl", article: "listUrl", site: "siteUrl", pdf: "listUrl", none: "siteUrl" }[s.type] || "siteUrl";
  s[field] = val;
}

/* Hôte de la source, sans « www. ». Le site d'abord : un flux RSS est souvent
   servi par un sous-domaine technique (feeds., rss.) ou une plateforme tierce. */
export function sourceHost(s) {
  for (const f of URL_FIELDS) {
    const v = s && s[f];
    if (!v) continue;
    try { return new URL(v).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { /* URL illisible : champ suivant */ }
  }
  return "";
}

/* Clé de regroupement : la casse, les accents et les espaces ne séparent pas
   deux organisations — « Mairie de La Rochelle » et « mairie de la rochelle »
   sont la même. Vide = sans organisation. */
export function organisationKey(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/* Propositions de pré-remplissage, en Map id → organisation proposée.

   Seulement pour une source SANS organisation, et seulement si son domaine est
   partagé par au moins une autre source : un groupe d'une seule source n'apporte
   rien et ferait du bruit dans la colonne. Si une autre source du même domaine a
   déjà une organisation, on propose celle-là — la nouvelle source rejoint le
   groupe existant au lieu d'en créer un second sous le nom du domaine. Sinon, on
   propose le domaine lui-même, que l'administrateur renommera.

   Deux organisations différentes sur un même domaine (plateforme commune) en
   ressortiraient fusionnées : c'est pour cela que c'est une proposition, relue
   avant d'être enregistrée, et non une écriture automatique. */
export function suggestOrganisations(sources) {
  const byHost = new Map();
  for (const s of sources || []) {
    const h = sourceHost(s);
    if (!h) continue;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(s);
  }
  const out = new Map();
  for (const [host, group] of byHost) {
    if (group.length < 2) continue;
    const named = group.find((s) => organisationKey(s.organisation));
    const value = named ? named.organisation.trim() : host;
    for (const s of group) if (!organisationKey(s.organisation)) out.set(s.id, value);
  }
  return out;
}

/* Sources regroupées par organisation, dans l'ordre de première apparition :
   [{ key, label, sources: [...] }]. Les sources sans organisation forment
   chacune leur propre groupe d'une ligne (key = "", label = null) — elles ne
   sont ni masquées ni rassemblées dans un « divers » qui les noierait. Le libellé
   affiché est le premier rencontré : les variantes de casse ne se voient pas. */
export function groupSources(sources) {
  const groups = [];
  const index = new Map();
  for (const s of sources || []) {
    const key = organisationKey(s.organisation);
    if (!key) { groups.push({ key: "", label: null, sources: [s] }); continue; }
    if (!index.has(key)) {
      const g = { key, label: s.organisation.trim(), sources: [] };
      index.set(key, g);
      groups.push(g);
    }
    index.get(key).sources.push(s);
  }
  return groups;
}
