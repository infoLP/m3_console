/* Liste noire d'adresses IP (M3-44) : le service de production, et les handlers
   de l'onglet Sécurité du back-office. La règle est dans src/lib/ipBan.js. */

import { send } from "../lib/http.js";
import { pushCollection } from "../lib/store.js";
import { journal } from "../lib/journal.js";
import { log } from "../lib/log.js";
import { can } from "../../shared/model.js";
import { clientIp, peerHookActive } from "../lib/clientIp.js";
import { banConfig, banNotification, createIpBans, pgRepo } from "../lib/ipBan.js";

/* Notification `ip_bannie` et journal, à chaque NOUVEAU bannissement. Le journal
   est écrit ici, explicitement : journalNotification() ne connaît pas ce type. */
export const ipBans = createIpBans({
  repo: pgRepo(),
  onBan: async (ban) => {
    log.warn("auth", "ip bannie", { ip: ban.ip, motif: ban.reason, refus: ban.failures || undefined });
    journal("connexion", "IP bannie", {
      level: "warn", target: ban.ip,
      detail: { motif: ban.reason, refus: ban.failures, identifiants: ban.logins, par: ban.bannedBy },
      ...(ban.reason === "auto" ? { actor: null } : {}),
    });
    await pushCollection("notifications", banNotification(ban));
  },
  onUnban: async ({ ip, by }) => {
    log.info("auth", "ip débannie", { ip, par: by || undefined });
    journal("connexion", "IP débannie", { target: ip, detail: { par: by } });
  },
});

let avertiSansCrochet = false;

/* L'adresse du client pour la requête du pont, ou null. Prévient une fois si le
   crochet de src/instrumentation.ts n'est pas actif : la mesure est alors
   inerte, et il faut que cela se voie. */
export function requestIp(req) {
  if (!peerHookActive() && !avertiSansCrochet) {
    avertiSansCrochet = true;
    log.warn("auth", "adresse client inconnue", { motif: "crochet d'instrumentation inactif : aucune adresse ne sera bannie" });
  }
  return clientIp(req?.headers || {}, { trusted: banConfig().trusted });
}

/* ---------------------------------------------------------- back-office */

const reserve = (role) => !can(role, "manage_users");

export async function bansList({ res, role, req }) {
  if (reserve(role)) return send(res, 403, { error: "réservé à l'administrateur" });
  const cfg = banConfig();
  send(res, 200, {
    bans: await ipBans.list(),
    selfIp: requestIp(req),
    threshold: cfg.threshold,
    windowHours: Math.round(cfg.windowMs / 3600000),
    trustedProxies: cfg.trusted.entries,
    exempt: cfg.exempt.entries,
  });
}

export async function banIp({ res, role, req, body, user }) {
  if (reserve(role)) return send(res, 403, { error: "réservé à l'administrateur" });
  const r = await ipBans.ban(String(body?.ip || ""), {
    by: user?.name || user?.login || null, note: body?.note, selfIp: requestIp(req),
  });
  send(res, 200, { ok: true, ...r });
}

export async function unbanIp({ res, role, params, user }) {
  if (reserve(role)) return send(res, 403, { error: "réservé à l'administrateur" });
  const r = await ipBans.unban(params[0], { by: user?.name || user?.login || null });
  if (!r.removed) return send(res, 404, { error: `${r.ip} n'est pas dans la liste noire` });
  send(res, 200, { ok: true, ...r });
}
