/* Garde SSRF du crawl des concurrents (M3-121, T11).

   Un concurrent est une adresse saisie au back-office : sans garde, le serveur
   irait lire ce qu'on lui désigne, y compris le réseau interne (Postgres, la
   console d'administration de l'hôte, les métadonnées du nuage en
   169.254.169.254). Refusés, avant toute requête :
   - un hôte local par son nom (localhost, *.local, *.internal…) ;
   - toute IP littérale, publique comprise : un site de presse a un nom ;
   - un nom dont UNE des adresses est privée, de bouclage, lien-local ou de
     métadonnées (privateIp de src/publish/illustrationUrl.js).
   La vérification du nom EST la connexion (safeGet de src/publish, sa résolution
   validée) : pas de fenêtre de DNS rebinding entre le contrôle et la requête.
   Chaque redirection repasse par la même garde, 5 au plus. */

import dns from "node:dns";

import { safeGet, checkedLookup } from "../publish/safeGet.js";
import { privateHostName } from "../publish/illustrationUrl.js";
import { UA } from "./net.js";

const MAX_BYTES = 3 * 1024 * 1024; // comme fetchCapped
const MAX_REDIRECTS = 5;
const isIpLiteral = (host) => host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host) || host.includes(":");

/* Raison du refus d'une URL par son seul nom d'hôte, ou null. Sans réseau. */
export function refusedHost(url) {
  let u;
  try { u = new URL(url); } catch { return "adresse invalide"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "protocole refusé";
  if (u.username || u.password) return "identifiants dans l'adresse";
  const host = u.hostname.toLowerCase();
  if (isIpLiteral(host)) return `adresse IP littérale refusée (${host})`;
  if (privateHostName(host)) return `hôte local refusé (${host})`;
  return null;
}

/* Raison du refus, résolution DNS comprise (toutes les adresses), ou null.
   Pour juger un concurrent avant de lancer son crawl, message clair à l'appui. */
export async function refusedUrl(url, { lookup = dns.lookup } = {}) {
  const why = refusedHost(url);
  if (why) return why;
  const host = new URL(url).hostname;
  return new Promise((resolve) => {
    checkedLookup({ lookup })(host, { all: true }, (err) => {
      if (!err) return resolve(null);
      resolve(err.code === "M3_PRIVATE_ADDRESS" ? err.message : null); // nom introuvable : le crawl le dira
    });
  });
}

/* fetcher(url, { timeoutMs }) → texte, au format de fetchCapped (erreur
   « HTTP nnn » hors 2xx, que crawlCompetitor lit pour robots.txt). `get` et
   `lookup` injectables pour les tests. */
export function safeFetcher({ get = safeGet, lookup } = {}) {
  return async function fetchSafe(url, { timeoutMs = 15000 } = {}) {
    let u = new URL(url);
    for (let hop = 0; ; hop++) {
      const why = refusedHost(u.href);
      if (why) throw Object.assign(new Error(`refusé : ${why}`), { code: "M3_SSRF" });
      const res = await get(u.href, { headers: { "User-Agent": UA }, timeoutMs, ...(lookup ? { lookup } : {}) });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        res.cancel?.();
        if (!location) throw new Error(`HTTP ${res.status}`);
        if (hop >= MAX_REDIRECTS) throw new Error(`plus de ${MAX_REDIRECTS} redirections`);
        u = new URL(location, u);
        continue;
      }
      if (!res.ok) { res.cancel?.(); throw new Error(`HTTP ${res.status}`); }
      const chunks = [];
      let total = 0;
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > MAX_BYTES) { res.cancel?.(); throw new Error("réponse trop volumineuse"); }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString("utf8");
    }
  };
}
