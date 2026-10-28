/* Détection et contrôle de la date d'un article récupéré.
   Objectif : repérer les dates aberrantes (futur lointain, trop ancien) et
   nettoyer les « Publié le … » qui polluent titres et chapôs. */

const MONTHS = {
  janvier: 0, "janv": 0, fevrier: 1, "fevr": 1, "fev": 1, mars: 2, avril: 3, "avr": 3, mai: 4,
  juin: 5, juillet: 6, "juil": 6, aout: 7, septembre: 8, "sept": 8, octobre: 9, "oct": 9,
  novembre: 10, "nov": 10, decembre: 11, "dec": 11,
};

function deaccent(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/* Parse une date française « 14 octobre 2026 » (année obligatoire ici). */
function frDate(s) {
  const m = deaccent(s).match(/\b(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})\b/);
  if (!m) return null;
  const mon = MONTHS[m[2]];
  if (mon == null) return null;
  const d = new Date(Number(m[3]), mon, Number(m[1]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* Cherche une date de parution dans le titre + le texte.
   source « label » : la date suit une étiquette de parution explicite — seule
   provenance assez sûre pour conclure qu'un article est daté du futur.
   « iso » / « texte » : date trouvée au hasard, qui peut être une échéance citée.
   M3-71 : le simple mot « le » valait étiquette, si bien que « avant le 15 mai
   2027 » passait pour la date de parution. */
export function contentDate(title, rawText) {
  const head = `${title || ""} \n ${String(rawText || "").slice(0, 600)}`;
  const labelled = deaccent(head).match(
    /\b(?:publiee?|mis en ligne|(?:derniere )?mise? a jour|date de publication)\s*(?:le\s*)?:?\s*(\d{1,2}\s+[a-z]+\.?\s+\d{4})/
  );
  if (labelled) {
    const d = frDate(labelled[1]);
    if (d) return { date: d, source: "label" };
  }
  const iso = head.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12);
    if (!Number.isNaN(d.getTime())) return { date: d, source: "iso" };
  }
  const any = frDate(head);
  if (any) return { date: any, source: "texte" };
  return null;
}

/* Date de PARUTION écrite dans un texte (M3-115) : « Publié le 16 sept. 2024 »,
   « Mis en ligne le … », « Date de publication : … ». « Mis à jour le » est exclu :
   ce n'est pas la parution. Sert à la récolte, pour les pages sans balise de date. */
export function publicationDate(text) {
  const m = deaccent(text)
    .replace(/\b(\d{1,2})er\b/g, "$1")
    .match(/\b(?:publiee?|mise? en ligne|date de publication)\s*(?:le\s*)?:?\s*(\d{1,2}\s+[a-z]+\.?\s+\d{4})/);
  return m ? frDate(m[1]) : null;
}

/* Contrôle de plausibilité. windowHours = fenêtre de récupération.
   futureMarginDays : au-delà, la date future est jugée suspecte (annonces
   d'événements à ~2 mois restent acceptées).
   contentSource : provenance de contentDt (cf. contentDate). Une date future non
   étiquetée est presque toujours une échéance citée : on l'écarte et on juge sur
   la date de la récolte, s'il y en a une. Le contrôle « trop ancien » vaut, lui,
   quelle que soit la provenance.
   Défaut de windowHours = celui du réglage window_hours (72 h), comme le
   repli de finalize — et non plus 336 (M3-113, relecture 4). */
export function assessDate({ contentDt, contentSource = "label", harvestPublishedAt, windowHours = 72, futureMarginDays = 60, now = Date.now() }) {
  const harvestDt = harvestPublishedAt ? new Date(harvestPublishedAt) : null;
  let dt = contentDt || harvestDt;
  if (contentDt && contentSource !== "label" && contentDt.getTime() - now > futureMarginDays * 86400000) {
    dt = harvestDt;
  }
  if (!dt || Number.isNaN(dt.getTime())) return { ok: true, date: null, reason: null };

  const ageDays = (now - dt.getTime()) / 86400000;
  if (ageDays < -futureMarginDays) {
    return { ok: false, date: dt, reason: "future", detail: `Date annoncée : ${fmt(dt)} (dans le futur).` };
  }
  const maxAgeDays = windowHours / 24 + 7;
  if (ageDays > maxAgeDays) {
    return { ok: false, date: dt, reason: "trop_ancien", detail: `Date annoncée : ${fmt(dt)} (hors fenêtre de récupération).` };
  }
  return { ok: true, date: dt, reason: null };
}

/* Contrôle de date AVANT les appels au modèle (M3-115, piste 2) : un article
   hors fenêtre de récupération n'est plus rédigé puis signalé, il est écarté.
   Plus prudent que la finalisation, qui ne fait que signaler : seules comptent
   une date étiquetée (« Publié le … ») et la date de parution de la récolte ;
   une date trouvée au hasard du texte (souvent un événement passé cité) laisse
   l'article suivre son cours. Seul « trop_ancien » écarte : le futur reste au
   contrôle de la finalisation. Renvoie le verdict d'assessDate, ou null. */
export function dateGate({ title, rawText, publishedAt, windowHours = 72, now = Date.now() }) {
  const cd = contentDate(title, rawText);
  const labelled = cd && cd.source === "label" ? cd.date : null;
  const r = assessDate({ contentDt: labelled, harvestPublishedAt: publishedAt, windowHours, now });
  return !r.ok && r.reason === "trop_ancien" ? r : null;
}

function fmt(d) {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/* Retire les préfixes « Publié le … », « Dernière mise à jour le … », etc.
   d'une chaîne (titre, chapô, paragraphe). */
export function stripDateNoise(s) {
  return String(s || "")
    .replace(/^\s*(publi[ée]\s+le|derni[èe]re\s+mise\s+[àa]\s+jour\s+le|mis[e]?\s+[àa]\s+jour\s+le|mis\s+en\s+ligne\s+le)\s+\d{1,2}\s+[a-zà-ÿ]+\.?\s+\d{4}\s*[:.–-]?\s*/i, "")
    .replace(/\b(publi[ée]\s+le|derni[èe]re\s+mise\s+[àa]\s+jour\s+le|mis[e]?\s+[àa]\s+jour\s+le)\s+\d{1,2}\s+[a-zà-ÿ]+\.?\s+\d{4}\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
