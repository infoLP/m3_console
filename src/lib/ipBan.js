/* Liste noire d'adresses IP (M3-44).

   Après `threshold` connexions par mot de passe refusées depuis une même adresse
   sur `windowMs`, l'adresse est bannie : la connexion par mot de passe lui est
   refusée jusqu'au débannissement. Persisté en base (migration 016), donc commun
   à tous les conteneurs et insensible au redémarrage — à la différence de la
   limitation par identifiant de src/lib/auth.js, qui reste en mémoire.

   Les trois pièges de TODO.md, et où ils sont traités :
     1. l'adresse du proxy  → src/lib/clientIp.js, et `protection()` ci-dessous :
        une adresse inconnue, réservée (privée, boucle locale) ou de proxy de
        confiance n'est jamais bannie ;
     2. se bannir soi-même  → le back-office refuse de bannir l'adresse de celui
        qui demande ; M3_IP_BAN_EXEMPT met des adresses hors d'atteinte ; la
        commande `node src/tools/ipBanAdmin.js --unban <ip>` débannit sans
        passer par la connexion ; et le SSO Entra n'est pas concerné ;
     3. l'identifiant tenté peut être un mot de passe → `attemptLabel()`.

   Le service est écrit contre un « dépôt » (repo) : `pgRepo` en production, un
   dépôt en mémoire dans les tests (test/ipBan.test.js). */

import { query as pgQuery } from "./db.js";
import { loginCourt } from "./log.js";
import { inList, isReservedIp, normalizeIp, parseIpList, trustedProxies } from "./clientIp.js";

export const DEFAULT_THRESHOLD = 15;
export const DEFAULT_WINDOW_HOURS = 24;
/* Identifiants distincts gardés par adresse : de quoi voir ce qui a été tenté,
   pas de quoi constituer un fichier. */
export const MAX_LOGINS = 10;

/* ------------------------------------------------------------ réglages */

export function banConfig(env = process.env) {
  const n = Number(env.M3_IP_BAN_THRESHOLD);
  const h = Number(env.M3_IP_BAN_WINDOW_HOURS);
  return {
    /* 0 désactive le bannissement automatique (la liste reste appliquée). */
    threshold: Number.isInteger(n) && n >= 0 && String(env.M3_IP_BAN_THRESHOLD ?? "").trim() !== "" ? n : DEFAULT_THRESHOLD,
    windowMs: (Number.isFinite(h) && h > 0 ? h : DEFAULT_WINDOW_HOURS) * 3600 * 1000,
    trusted: trustedProxies(env),
    exempt: parseIpList(env.M3_IP_BAN_EXEMPT),
  };
}

/* Ce qui mérite d'être dit au démarrage : liste illisible, ou bannissement
   actif sans proxy de confiance déclaré derrière un proxy. */
export function banConfigWarnings(cfg = banConfig()) {
  const out = [];
  if (cfg.trusted.invalid.length) out.push(`M3_TRUSTED_PROXIES : entrée(s) illisible(s) ignorée(s) : ${cfg.trusted.invalid.join(", ")}`);
  if (cfg.exempt.invalid.length) out.push(`M3_IP_BAN_EXEMPT : entrée(s) illisible(s) ignorée(s) : ${cfg.exempt.invalid.join(", ")}`);
  /* Sans proxy de confiance, X-Forwarded-For est ignoré : derrière Traefik, toutes
     les connexions semblent venir du proxy, adresse privée jamais bannie — la
     mesure est alors inerte (sans danger, mais sans effet). */
  if (!cfg.trusted.entries.length && cfg.threshold) out.push("M3_TRUSTED_PROXIES est vide : derrière un proxy, l'adresse du client ne peut pas être établie et aucune adresse ne sera bannie");
  return out;
}

/* Pourquoi cette adresse ne peut pas être bannie, ou null si elle le peut. */
export function protection(ip, cfg = banConfig(), { selfIp = null } = {}) {
  const n = normalizeIp(ip);
  if (!n) return "adresse IP invalide";
  if (inList(n, cfg.trusted)) return "adresse d'un proxy de confiance (M3_TRUSTED_PROXIES)";
  if (isReservedIp(n)) return "adresse privée ou locale : c'est celle d'un proxy ou du réseau interne";
  if (inList(n, cfg.exempt)) return "adresse exemptée (M3_IP_BAN_EXEMPT)";
  if (selfIp && normalizeIp(selfIp) === n) return "c'est votre propre adresse : vous vous fermeriez la porte";
  return null;
}

/* Piège 3 : l'identifiant tenté est souvent un mot de passe tapé dans le mauvais
   champ. Il n'est conservé en entier que s'il correspond à un compte existant ;
   sinon tronqué s'il a la forme d'une adresse, et réduit à sa longueur sinon —
   un mot de passe contient rarement « @ ». */
export function attemptLabel(login, { knownAccount = false } = {}) {
  const s = String(login ?? "").trim();
  if (!s) return "(vide)";
  if (knownAccount) return s.slice(0, 200);
  if (/^[^@\s]+@[^@\s]+$/.test(s)) return `${loginCourt(s)} (inconnu)`;
  return `(identifiant inconnu, ${s.length} caractère${s.length > 1 ? "s" : ""})`;
}

/* --------------------------------------------------------------- dépôt */

export function pgRepo(query = pgQuery) {
  return {
    async isBanned(ip) {
      const { rows } = await query("SELECT 1 FROM ip_bans WHERE ip = $1", [ip]);
      return rows.length > 0;
    },
    /* Un seul aller-retour, atomique : deux conteneurs qui comptent en même
       temps ne perdent pas de refus. La fenêtre expirée repart de 1. */
    async recordFailure(ip, label, windowMs) {
      const { rows } = await query(
        `INSERT INTO ip_failures (ip, count, first_at, last_at, logins)
         VALUES ($1, 1, now(), now(), ARRAY[$2]::text[])
         ON CONFLICT (ip) DO UPDATE SET
           count    = CASE WHEN ip_failures.first_at < now() - ($3 || ' milliseconds')::interval
                           THEN 1 ELSE ip_failures.count + 1 END,
           logins   = CASE WHEN ip_failures.first_at < now() - ($3 || ' milliseconds')::interval
                             THEN ARRAY[$2]::text[]
                           WHEN $2 = ANY(ip_failures.logins) OR cardinality(ip_failures.logins) >= $4
                             THEN ip_failures.logins
                           ELSE array_append(ip_failures.logins, $2) END,
           first_at = CASE WHEN ip_failures.first_at < now() - ($3 || ' milliseconds')::interval
                           THEN now() ELSE ip_failures.first_at END,
           last_at  = now()
         RETURNING count, logins`,
        [ip, label, String(windowMs), MAX_LOGINS]
      );
      /* Balayage au fil de l'eau : il n'y a pas d'ordonnanceur côté web. */
      query("DELETE FROM ip_failures WHERE last_at < now() - ($1 || ' milliseconds')::interval", [String(windowMs)]).catch(() => {});
      return { count: rows[0].count, logins: rows[0].logins || [] };
    },
    async clearFailures(ip) {
      await query("DELETE FROM ip_failures WHERE ip = $1", [ip]);
    },
    /* Rend true si l'adresse vient d'entrer dans la liste (false : déjà bannie). */
    async insertBan({ ip, reason, failures = 0, logins = [], bannedBy = null, note = null }) {
      const { rowCount } = await query(
        `INSERT INTO ip_bans (ip, reason, failures, logins, banned_by, note)
         VALUES ($1, $2, $3, $4::text[], $5, $6)
         ON CONFLICT (ip) DO NOTHING`,
        [ip, reason, failures, logins, bannedBy, note]
      );
      return rowCount > 0;
    },
    async removeBan(ip) {
      const { rowCount } = await query("DELETE FROM ip_bans WHERE ip = $1", [ip]);
      return rowCount > 0;
    },
    async list() {
      const { rows } = await query(
        `SELECT ip, banned_at, reason, failures, logins, banned_by, note
           FROM ip_bans ORDER BY banned_at DESC, ip LIMIT 1000`
      );
      return rows.map((r) => ({
        ip: r.ip,
        bannedAt: r.banned_at instanceof Date ? r.banned_at.toISOString() : String(r.banned_at),
        reason: r.reason, failures: r.failures, logins: r.logins || [],
        bannedBy: r.banned_by, note: r.note,
      }));
    },
  };
}

/* ------------------------------------------------------------- service */

const erreur = (status, message) => Object.assign(new Error(message), { status });

/* `onBan(ban)` est appelé APRÈS l'écriture d'un nouveau bannissement (automatique
   ou manuel) : notification et journal. Une erreur dans `onBan` ne défait pas le
   bannissement. */
export function createIpBans({ repo = pgRepo(), config = () => banConfig(), onBan = async () => {}, onUnban = async () => {} } = {}) {
  const cfg = () => (typeof config === "function" ? config() : config);

  async function notifier(fn, arg) {
    try { await fn(arg); } catch { /* la liste noire prime sur la notification */ }
  }

  return {
    async isBanned(ip) {
      const n = normalizeIp(ip);
      /* Une adresse protégée n'est jamais tenue pour bannie, même présente en
         base : ajouter une adresse à M3_IP_BAN_EXEMPT est un recours. */
      if (!n || protection(n, cfg())) return false;
      return repo.isBanned(n);
    },

    /* Une connexion refusée depuis `ip`. Rend { counted, count, banned }. */
    async recordFailure(ip, label) {
      const c = cfg();
      const n = normalizeIp(ip);
      if (!n || protection(n, c)) return { counted: false, count: 0, banned: false };
      const { count, logins } = await repo.recordFailure(n, label, c.windowMs);
      if (!c.threshold || count < c.threshold) return { counted: true, count, banned: false };
      const inserted = await repo.insertBan({ ip: n, reason: "auto", failures: count, logins });
      await repo.clearFailures(n);
      if (inserted) await notifier(onBan, { ip: n, reason: "auto", failures: count, logins, bannedBy: null });
      return { counted: true, count, banned: inserted };
    },

    async recordSuccess(ip) {
      const n = normalizeIp(ip);
      if (n) await repo.clearFailures(n);
    },

    /* Bannissement manuel. `selfIp` : l'adresse de celui qui demande. */
    async ban(ip, { by = null, note = null, selfIp = null } = {}) {
      const n = normalizeIp(ip);
      const pourquoi = protection(ip, cfg(), { selfIp });
      if (pourquoi) throw erreur(400, `impossible de bannir ${n || String(ip ?? "").slice(0, 60)} : ${pourquoi}`);
      const inserted = await repo.insertBan({
        ip: n, reason: "manuel", bannedBy: by,
        note: note ? String(note).trim().slice(0, 300) || null : null,
      });
      if (!inserted) throw erreur(409, `${n} est déjà dans la liste noire`);
      await notifier(onBan, { ip: n, reason: "manuel", failures: 0, logins: [], bannedBy: by });
      return { ip: n };
    },

    async unban(ip, { by = null } = {}) {
      const n = normalizeIp(ip);
      if (!n) throw erreur(400, "adresse IP invalide");
      const removed = await repo.removeBan(n);
      await repo.clearFailures(n);
      if (removed) await notifier(onUnban, { ip: n, by });
      return { ip: n, removed };
    },

    list: () => repo.list(),
  };
}

/* --------------------------------------------------- notification, journal */

/* Le texte de la notification `ip_bannie`. Visible de quiconque lit les
   notifications : les identifiants y sont déjà assainis (attemptLabel). */
export function banNotification(ban, now = new Date()) {
  const qui = ban.reason === "manuel"
    ? `bannie à la main${ban.bannedBy ? ` par ${ban.bannedBy}` : ""}`
    : `bannie après ${ban.failures} connexions refusées`;
  const tentes = ban.logins?.length ? ` Identifiants tentés : ${ban.logins.join(", ")}.` : "";
  return {
    id: `n-${now.getTime()}-ip-${ban.ip}`,
    type: "ip_bannie",
    severity: "warning",
    sourceName: ban.ip,
    detail: `Adresse ${ban.ip} ${qui}.${tentes} Débannir : back-office, onglet Sécurité.`,
    at: now.toISOString(),
    read: false,
  };
}
