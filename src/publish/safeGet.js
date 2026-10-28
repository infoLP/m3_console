/* GET HTTP(S) dont la connexion ne part que vers une IP vérifiée (M3-66, T5).

   `fetch` résout le nom d'hôte lui-même, APRÈS toute vérification faite en
   amont : un DNS qui répond d'abord une IP publique puis une IP privée (DNS
   rebinding) passait. Ici la vérification EST la résolution : le `lookup` de
   node:http(s) refuse si une seule des adresses est privée, et la socket se
   connecte à l'adresse qu'il vient de valider. Une résolution, une décision.

   Le nom d'hôte reste celui de l'URL pour l'en-tête Host et le SNI (https) ;
   seule l'IP vient du lookup. Pas d'agent partagé (agent: false) : aucune
   socket réutilisée d'une requête à l'autre, chaque redirection repasse par
   ce même lookup. Une IP littérale ne passe pas par le lookup : l'appelant la
   juge avant (privateHostName). Aucune dépendance : node:http(s) et node:dns. */

import dns from "node:dns";
import http from "node:http";
import https from "node:https";

import { privateIp } from "./illustrationUrl.js";

export const PRIVATE_ADDRESS = "M3_PRIVATE_ADDRESS";

/* `lookup` au format de net.connect, bâti sur une résolution (dns.lookup par
   défaut) dont TOUTES les adresses sont jugées. Node l'appelle avec `all: true`
   quand autoSelectFamily est actif (défaut) : on rend alors la liste validée. */
export function checkedLookup({ lookup = dns.lookup, allowPrivate = false, isPrivate = privateIp } = {}) {
  return (hostname, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    const opts = typeof options === "number" ? { family: options } : { ...(options || {}) };
    lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = [].concat(addresses || []).map((a) => (typeof a === "string" ? { address: a, family: a.includes(":") ? 6 : 4 } : a));
      if (!list.length) return callback(Object.assign(new Error(`aucune adresse pour ${hostname}`), { code: "ENOTFOUND" }));
      const bad = allowPrivate ? null : list.find((a) => isPrivate(a.address));
      if (bad) return callback(Object.assign(new Error(`${hostname} désigne une adresse privée (${bad.address})`), { code: PRIVATE_ADDRESS }));
      if (opts.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

/* → { status, ok, headers.get(), body (flux itérable), cancel() }. Les
   redirections ne sont PAS suivies : l'appelant revalide chaque saut. Le délai
   couvre tout l'échange, corps compris (un serveur qui distille ne tient pas). */
export function safeGet(url, { headers = {}, timeoutMs = 15000, lookup, allowPrivate = false, isPrivate } = {}) {
  const u = new URL(url);
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(u, {
      method: "GET",
      headers,
      agent: false,
      lookup: checkedLookup({ ...(lookup ? { lookup } : {}), allowPrivate, ...(isPrivate ? { isPrivate } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    }, (res) => {
      resolve({
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        headers: { get: (n) => { const v = res.headers[String(n).toLowerCase()]; return v == null ? null : [].concat(v).join(", "); } },
        body: res,
        cancel: () => res.destroy(),
      });
    });
    req.on("error", reject);
    req.end();
  });
}
