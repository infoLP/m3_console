/* Fiabilité d'une source — fonctions pures, partagées backend + navigateur.

   Jusqu'au 2026-10-14, une source n'avait qu'un état d'échec (sourceSchedule.js) :
   une source qui répond 200 sans jamais rien rapporter passait pour saine. 17
   sources actives sur 34 étaient dans ce cas sans que rien ne le signale.

   Le rendement de chaque récolte s'ajoute à l'état de la source, sous `yield` :
     { runs, okRuns, items, emptyStreak, lastItemAt, recent: [{ at, ok, n }] }
   (harvest/sources-state.json — l'objet est déjà préservé par afterAttempt). */

const DAY = 86400000;
export const RECENT_RUNS = 10;
/* Récoltes réussies d'affilée sans aucun contenu nouveau avant l'alerte. */
export const MUTE_AFTER = 5;

/* Nouveau `yield` après une tentative. `muteNow` vaut true au moment précis où la
   source devient muette : c'est là, et seulement là, qu'on notifie. */
export function recordYield(prev, { ok, count = 0, at = new Date().toISOString() }) {
  const y = { runs: 0, okRuns: 0, items: 0, emptyStreak: 0, lastItemAt: null, recent: [], ...(prev || {}) };
  y.runs++;
  if (ok) y.okRuns++;
  y.items += count;
  if (count > 0) { y.lastItemAt = at; y.emptyStreak = 0; }
  else if (ok) y.emptyStreak++;
  y.recent = [...(y.recent || []), { at, ok: !!ok, n: count }].slice(-RECENT_RUNS);
  return { yield: y, muteNow: ok && count === 0 && y.emptyStreak === MUTE_AFTER };
}

const clamp = (x) => Math.max(0, Math.min(1, x));

/* Score sur 100 et niveau. `articles` : décomptes par statut des articles générés
   depuis la source ({ valide, publie, archive, signale, ... }).
   Pondération : disponibilité 25, rendement 30, fraîcheur 20, éditorial 25.
   Sans assez d'articles décidés (< 3), le volet éditorial est ignoré et les
   autres sont remis à l'échelle — on ne pénalise pas une source neuve. */
export function reliabilityOf(y, articles = {}, now = Date.now()) {
  const recent = (y && y.recent) || [];
  if (recent.length < 3) return { score: null, level: "nouvelle", reasons: ["moins de 3 récoltes"] };

  const reasons = [];
  const okRate = recent.filter((r) => r.ok).length / recent.length;
  if (okRate < 0.7) reasons.push(`${Math.round((1 - okRate) * 100)} % d'échecs`);

  const okRuns = recent.filter((r) => r.ok);
  const perRun = okRuns.length ? okRuns.reduce((a, r) => a + r.n, 0) / okRuns.length : 0;
  if (perRun === 0) reasons.push(`aucun contenu sur les ${recent.length} dernières récoltes`);

  const ageDays = y.lastItemAt ? (now - Date.parse(y.lastItemAt)) / DAY : Infinity;
  const fresh = clamp((30 - ageDays) / 23); // 7 j ou moins → 1 ; 30 j ou plus → 0
  if (ageDays > 30 && perRun > 0) reasons.push("rien de neuf depuis plus de 30 jours");

  const accepted = (articles.valide || 0) + (articles.publie || 0);
  const rejected = (articles.archive || 0) + (articles.signale || 0);
  const decided = accepted + rejected;

  let total = 25 * okRate + 30 * clamp(perRun) + 20 * fresh;
  let max = 75;
  if (decided >= 3) {
    const acc = accepted / decided;
    total += 25 * acc;
    max += 25;
    if (acc < 0.5) reasons.push(`${rejected} article(s) écartés sur ${decided}`);
  }
  const score = Math.round((100 * total) / max);
  const level = (y.emptyStreak || 0) >= MUTE_AFTER ? "muette" : score >= 70 ? "fiable" : score >= 40 ? "moyenne" : "faible";
  return { score, level, reasons };
}
