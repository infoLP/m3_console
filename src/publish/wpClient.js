/* Transport HTTP vers l'API REST WordPress. Rien d'autre : aucune règle métier.
   `fetch` est injectable — les tests n'appellent JAMAIS un vrai WordPress.

   Toutes les requêtes passent par `<site>/?rest_route=/wp/v2/…`, jamais par
   `/wp-json/…` : la première forme marche que les permaliens « jolis » soient
   activés ou non, la seconde exige qu'ils le soient (et que le serveur réécrive
   l'URL). C'est aussi ce que fait M2 (M2_Console, client WordPress). Les appelants
   donnent donc la ROUTE REST (« /wp/v2/posts »), sans préfixe. */

export class WpError extends Error {
  constructor(message, { status = 0, code = "", data = null } = {}) {
    super(message);
    this.name = "WpError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/* Route « /wp/v2/tags?slug=x » → « <base>/?rest_route=/wp/v2/tags&slug=x ». */
export function restRouteUrl(base, route) {
  if (!String(route).startsWith("/") || String(route).startsWith("/wp-json")) {
    throw new Error(`route REST attendue sans préfixe /wp-json (ex. « /wp/v2/posts ») : ${route}`);
  }
  const [chemin, qs = ""] = String(route).split("?");
  const u = new URL(`${base}/`);
  u.searchParams.set("rest_route", chemin);
  for (const [k, v] of new URLSearchParams(qs)) u.searchParams.append(k, v);
  return u.toString();
}

export function createWpClient({ url, user, appPassword, fetch: doFetch = globalThis.fetch }) {
  const auth = "Basic " + Buffer.from(`${user}:${appPassword}`).toString("base64");

  /* `raw` : corps binaire déjà prêt (téléversement d'un média, M3-66), envoyé
     tel quel avec ses propres en-têtes au lieu d'être sérialisé en JSON. */
  async function request(method, route, body, raw = null) {
    let res;
    try {
      res = await doFetch(restRouteUrl(url, route), {
        method,
        headers: raw
          ? { Authorization: auth, Accept: "application/json", ...raw.headers }
          : { Authorization: auth, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: raw ? raw.body : body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new WpError(`WordPress injoignable (${method} ${route}) : ${e.message}`);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* page HTML d'erreur */ }
    if (!res.ok) {
      const msg = json?.message || text.slice(0, 200) || res.statusText;
      throw new WpError(`WordPress ${res.status} sur ${method} ${route} : ${msg}`, { status: res.status, code: json?.code || "", data: json?.data ?? null });
    }
    return json;
  }

  return {
    get: (route) => request("GET", route),
    post: (route, body) => request("POST", route, body),
    /* POST /wp/v2/media : le binaire en corps, le nom de fichier dans
       Content-Disposition — la forme que l'API REST attend pour un média. */
    upload: (route, bytes, { filename, contentType }) => request("POST", route, null, {
      body: bytes,
      headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${String(filename).replace(/["\\\r\n]/g, "_")}"` },
    }),
  };
}
