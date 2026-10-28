/* Contrôle anti-doublon : similarité de sujet entre un item de harvest et les
   articles déjà générés. Approche simple : trigrammes sur (titre + début du texte). */

function norm(str) {
  return String(str || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function trigrams(str) {
  const s = norm(str);
  const set = new Set();
  for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function subjectKey(titleOrItem, text = "") {
  // titre pondéré (compte double) + amorce du texte, pour limiter l'effet du
  // boilerplate de navigation commun à toutes les pages d'un même site.
  let title, body;
  if (typeof titleOrItem === "object") {
    title = titleOrItem.title || "";
    body = titleOrItem.chapo || titleOrItem.summary || "";
  } else {
    title = titleOrItem;
    body = text;
  }
  return `${title} ${title} ${String(body).slice(0, 120)}`;
}

/* existing = [{id, title, chapo|summary}] ; renvoie {isDuplicate, score, against} */
export function checkDuplicate(item, existing, threshold = 0.5) {
  const key = trigrams(subjectKey(item.title, item.summary || item.rawText));
  let best = { score: 0, against: null };
  for (const e of existing) {
    const score = jaccard(key, trigrams(subjectKey(e)));
    if (score > best.score) best = { score: Math.round(score * 100) / 100, against: e.id };
  }
  return { isDuplicate: best.score >= threshold, score: best.score, against: best.against };
}
