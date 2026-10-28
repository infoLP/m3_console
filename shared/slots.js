/* Créneaux de la chaîne planifiée (M3-58) — fonctions pures.

   Un créneau est une heure de Paris un jour donné, écrit « 2026-10-12 06:30 ».
   Écrit ainsi, il se compare comme une chaîne : pas de conversion de fuseau à
   faire juste, changement d'heure compris. L'ordonnanceur retient le dernier
   créneau traité ; un créneau plus récent et déjà passé est dû. */

const MAX_TIMES = 24;

/* « 06:30, 13:30 » → { times: ["06:30", "13:30"] }, triés et dédoublonnés, ou
   { error } avec un message lisible au back-office. */
export function parseTimes(text) {
  const parts = String(text ?? "").split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { error: "au moins un horaire, au format HH:MM" };
  const times = new Set();
  for (const p of parts) {
    const m = p.match(/^(\d{1,2})[:hH](\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: `« ${p} » n'est pas un horaire HH:MM` };
    times.add(`${m[1].padStart(2, "0")}:${m[2]}`);
  }
  if (times.size > MAX_TIMES) return { error: `${MAX_TIMES} horaires au plus` };
  return { times: [...times].sort() };
}

const PARIS = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/* Heure murale de Paris : { day: "2026-10-12", hm: "06:31", stamp: "2026-10-12 06:31" }. */
export function parisClock(now = Date.now()) {
  const p = Object.fromEntries(PARIS.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const hm = `${p.hour}:${p.minute}`;
  return { day, hm, stamp: `${day} ${hm}` };
}

/* Minutes entre deux heures murales. Le changement d'heure fausse le résultat
   d'une heure au plus, une nuit par semestre : sans conséquence pour un seuil
   de retard exprimé en heures. */
function minutesBetween(a, b) {
  const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16));
  return (t(b) - t(a)) / 60000;
}

/* Au-delà de ce retard, un créneau manqué (serveur arrêté) n'est pas rattrapé :
   lancer à 23 h la récolte prévue à 6 h 30 surprendrait plus qu'elle ne servirait. */
export const MAX_LATE_MINUTES = 6 * 60;

/* Que faire maintenant ?
   - { action: "run", slot }   un créneau est dû ;
   - { action: "skip", slot }  un créneau a été manqué de trop : on le marque
                               traité sans lancer, et on attend le suivant ;
   - { action: "init", slot }  premier passage (aucun créneau retenu) : on part
                               du créneau courant sans le lancer — activer la
                               planification ne doit pas déclencher une run sur-le-champ ;
   - { action: "wait" }        rien à faire. */
export function nextAction(times, lastSlot, now = Date.now()) {
  if (!times || !times.length) return { action: "wait" };
  const today = parisClock(now);
  const yesterday = parisClock(now - 86400000).day;
  const candidates = [
    ...times.map((t) => `${yesterday} ${t}`),
    ...times.map((t) => `${today.day} ${t}`),
  ].filter((s) => s <= today.stamp);
  const latest = candidates.length ? candidates[candidates.length - 1] : null;
  if (!latest) return { action: "wait" };
  if (!lastSlot) return { action: "init", slot: latest };
  if (latest <= lastSlot) return { action: "wait" };
  if (minutesBetween(latest, today.stamp) > MAX_LATE_MINUTES) return { action: "skip", slot: latest };
  return { action: "run", slot: latest };
}

/* Prochain créneau à venir, pour l'affichage (« prochaine run : 13:30 »). */
export function upcomingSlot(times, now = Date.now()) {
  if (!times || !times.length) return null;
  const today = parisClock(now);
  const later = times.find((t) => `${today.day} ${t}` > today.stamp);
  return later ? `${today.day} ${later}` : `${parisClock(now + 86400000).day} ${times[0]}`;
}

/* Instant ISO d'un créneau (« 2026-10-12 06:30 », heure de Paris), pour une API
   qui parle en instants (scanState, M3-121). Le décalage est lu sur l'horloge de
   Paris à cet instant ; la nuit d'un changement d'heure, l'erreur tient en une heure. */
export function slotToIso(slot) {
  if (!slot) return null;
  const asUtc = Date.UTC(+slot.slice(0, 4), +slot.slice(5, 7) - 1, +slot.slice(8, 10), +slot.slice(11, 13), +slot.slice(14, 16));
  return new Date(asUtc - minutesBetween(slot, parisClock(asUtc).stamp) * 60000).toISOString();
}

/* Réglages du scan des concurrents (M3-121, R2), avec leurs défauts tant qu'ils
   manquent : désactivé, 02:30, 10 articles par concurrent (1 à 50). */
export function scanSettings(settings = {}) {
  const max = Math.round(Number(settings.competitors_max_articles));
  return {
    enabled: settings.competitors_scan_enabled === "oui",
    times: parseTimes(settings.competitors_scan_times ?? "02:30"),
    maxArticles: max >= 1 ? Math.min(max, 50) : 10,
  };
}
