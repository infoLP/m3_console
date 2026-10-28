/* Ce qui reste de la couche HTTP de l'ancien serveur, après la phase 5 de
   docs/plans/PLAN-nextjs-migration.md : send(), que les 48 handlers de src/api appellent
   pour répondre, et que le pont (src/pont.ts) capture. readJsonBody,
   buildRoutes et matchRoute sont partis avec legacy/server.js.

   Toutes les réponses de l'API passent par ici : c'est le seul endroit où poser
   le garde-fou qui masque une clé d'API partie par mégarde. Il s'applique à la
   chaîne déjà sérialisée — une seule passe, au lieu de parcourir récursivement
   un index d'articles de plusieurs mégaoctets.

   Les en-têtes CORS datent du prototype servi depuis file:// ; le pont les
   retire de la réponse, le site étant same-origin derrière Traefik. Ils
   restent ici tant que send() n'est pas réécrit en tranches (à la fusion). */

import { redact } from "./redact.js";

export function send(res, status, body, type = "application/json") {
  const payload = redact(type === "application/json" ? JSON.stringify(body) : body);
  res.writeHead(status, {
    "Content-Type": type + (type.startsWith("text/") || type === "application/json" ? "; charset=utf-8" : ""),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-M3-Role",
  });
  res.end(payload);
}

/* fetch borné dans le temps, pour les appels sortants de la console (OIDC).
   Copie de fetchBounded (src/llm/limits.js, moteur) faite au lot 2 du découpage
   (T18) : la console n'importe plus le moteur. Le corps est lu en entier ;
   un dépassement donne « <label> : délai dépassé (N s) ». */
export async function fetchBounded(url, init, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      retryAfter: res.headers.get("retry-after"),
      text,
      /* Le corps est déjà lu : `json()` ne refait pas d'entrée-sortie, elle ne
         fait qu'analyser. Une réponse non-JSON (page d'erreur HTML d'un proxy,
         par exemple) donne un message qui cite le début du corps, au lieu du
         « Unexpected token < » de JSON.parse, qui ne dit pas d'où il vient. */
      json() {
        try { return JSON.parse(text); }
        catch { throw new Error(`${label} : réponse illisible (${text.slice(0, 120)})`); }
      },
    };
  } catch (err) {
    /* Sans ce message, un dépassement remonte en « This operation was aborted » :
       exact, mais rien n'y dit que c'est NOUS qui avons coupé, ni au bout de
       combien de temps. La distinction compte quand le repli mock se déclenche
       et qu'il faut savoir s'il faut relever llm_timeout_ms. */
    if (err.name === "AbortError") {
      throw new Error(`${label} : délai dépassé (${Math.round(timeoutMs / 1000)} s)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
