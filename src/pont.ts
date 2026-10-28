// Le pont : fait tourner les handlers existants de src/api/* — écrits pour
// node:http, qui répondent par send(res, …) — derrière Next.js, sans les
// réécrire. Deux visages sur la même mécanique (docs/plans/PLAN-nextjs-migration.md,
// « Le pont ») :
//
//   route(handler)   → un route handler Next.js (Request → Response). Il n'en
//                      reste qu'une poignée depuis la phase 5 : ce que le
//                      navigateur appelle encore par fetch (lectures sondées,
//                      article ouvert), la sonde Docker, les erreurs client.
//   action(handler)  → appelle le même handler depuis une action serveur et
//                      rend le corps, ou lève l'erreur avec son statut. C'est
//                      la forme de M2_Console, et celle de tout le reste.
//   navigation(fn)   → pour les deux rebonds du SSO et l'icône du site, écrits
//                      en (req, res, url) et non en handler(ctx).
//
// Ce que le pont refait de legacy/server.js, et rien de plus : lire la session
// (503 si la base ne répond pas), refuser sans session sauf les routes
// ouvertes, calculer le rôle effectif (« Voir comme »), lire le corps JSON
// (1 Mo), poser le contexte de requête du journal, écrire la ligne HTTP, ne
// jamais renvoyer une pile au client. Ce qu'il ne reproduit pas : les en-têtes
// CORS de send(), qui datent du prototype servi depuis file://.

import "server-only";
import { cookies, headers } from "next/headers";
import { readSession, readCookie, COOKIE_NAME } from "@/lib/auth.js";
import { log, loginCourt } from "@/lib/log.js";
import { requestContext } from "@/lib/journal.js";
import { ROLES } from "@shared/model.js";
import { lireConfig } from "@/config";
import { utilisateurCourant, COOKIE_VOIR_COMME, type Utilisateur, type Role } from "@/session";

/* --------------------------------------------------------------- types */

export interface Contexte {
  params: string[];
  query: Record<string, string>;
  body: unknown;
  user: Utilisateur | null;
  role: Role;
  req: RequeteSimulee;
  res: ReponseCapturee;
}
export type Handler = (ctx: Contexte) => unknown | Promise<unknown>;
export type Navigation = (req: RequeteSimulee, res: ReponseCapturee, url: URL) => unknown | Promise<unknown>;

interface RequeteSimulee {
  method: string;
  url: string;
  headers: Record<string, string>;
  on(): RequeteSimulee;
  destroy(): void;
}

/* Ce que send(), redirect() et serveSiteIcon() attendent d'un `res` node:http. */
export class ReponseCapturee {
  status = 200;
  statusCode = 200;
  headers = new Headers();
  body: string | Uint8Array | null = null;
  ended = false;
  private finir: (() => void) | null = null;

  writeHead(status: number, enTetes?: Record<string, string | number | string[]>) {
    this.status = status;
    this.statusCode = status;
    if (enTetes) for (const [k, v] of Object.entries(enTetes)) this.setHeader(k, v);
    return this;
  }
  setHeader(nom: string, valeur: string | number | string[]) {
    if (Array.isArray(valeur)) {
      this.headers.delete(nom);
      for (const v of valeur) this.headers.append(nom, String(v));
    } else {
      this.headers.set(nom, String(valeur));
    }
    return this;
  }
  getHeader(nom: string) { return this.headers.get(nom) ?? undefined; }
  end(morceau?: string | Uint8Array | Buffer | null) {
    if (morceau != null && morceau !== "") {
      this.body = typeof morceau === "string" ? morceau : new Uint8Array(morceau);
    }
    this.ended = true;
    this.finir?.();
  }
  on(evenement: string, fn: () => void) {
    if (evenement === "finish") this.finir = fn;
    return this;
  }
}

/* ----------------------------------------------------------- constantes */

/* Seules routes ouvertes sans session : la sonde Docker, et les erreurs du
   navigateur — celles de la page de connexion sont justement celles qu'on ne
   peut pas tracer autrement. (La connexion et les modes d'entrée sont des
   actions et des lectures serveur depuis la phase 5, plus des routes.) */
const OUVERTES = new Set(["/api/health", "/api/client-error"]);
const LIMITE_CORPS = 1024 * 1024;
const AVEC_CORPS = new Set(["POST", "PUT", "PATCH"]);

/* ------------------------------------------------------------- helpers */

function requeteDepuis(request: Request): RequeteSimulee {
  const url = new URL(request.url);
  const enTetes: Record<string, string> = {};
  request.headers.forEach((v, k) => { enTetes[k] = v; });
  return { method: request.method, url: url.pathname + url.search, headers: enTetes, on() { return this; }, destroy() {} };
}

function requeteDepuisEnTetes(h: Headers): RequeteSimulee {
  const enTetes: Record<string, string> = {};
  h.forEach((v, k) => { enTetes[k] = v; });
  return { method: "POST", url: "", headers: enTetes, on() { return this; }, destroy() {} };
}

function lireCookie(brut: string | undefined, nom: string): string | null {
  if (!brut) return null;
  for (const part of brut.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === nom) return part.slice(i + 1).trim();
  }
  return null;
}

/* Même règle que legacy/server.js : l'en-tête n'est lu que s'il est PRÉSENT,
   et seulement pour un administrateur. */
export function roleDemande(u: Utilisateur | null, enTete: string | null): Role {
  if (!u) return "relecteur";
  if (u.role !== "administrateur") return u.role;
  const demande = (enTete || "").toLowerCase();
  return demande in ROLES ? (demande as Role) : u.role;
}

async function lireCorps(request: Request): Promise<unknown> {
  if (!AVEC_CORPS.has(request.method)) return {};
  const texte = (await request.text()).trim();
  if (texte.length > LIMITE_CORPS) throw Object.assign(new Error("corps de requête trop volumineux"), { status: 400 });
  if (!texte) return {};
  try { return JSON.parse(texte); } catch { throw Object.assign(new Error("JSON invalide"), { status: 400 }); }
}

function json(status: number, corps: unknown): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/* La réponse capturée devient une Response web. Les en-têtes CORS de send()
   sont retirés : le site est same-origin derrière Traefik. */
function versResponse(res: ReponseCapturee): Response {
  const h = new Headers(res.headers);
  for (const k of [...h.keys()]) if (k.startsWith("access-control-")) h.delete(k);
  if (!h.has("cache-control")) h.set("Cache-Control", "no-store");
  const sansCorps = res.status === 204 || res.status === 304 || res.body == null;
  return new Response(sansCorps ? null : (res.body as BodyInit), { status: res.status, headers: h });
}

function ligneHttp(methode: string, pathname: string, statut: number, depart: number, user: Utilisateur | null) {
  const niveau = statut >= 500 ? "error" : statut >= 400 ? "warn" : "info";
  log[niveau]("http", `${methode} ${pathname}`, { statut, ms: Date.now() - depart, qui: user ? loginCourt(user.login) : undefined });
}

function erreurVersStatut(err: unknown): { status: number; message: string } {
  const e = err as { status?: number; message?: string };
  return { status: e?.status || 400, message: e?.message || String(err) };
}

/* Un Set-Cookie posé par un handler (connexion, déconnexion), appliqué par
   l'API cookies() de Next — c'est elle qui écrit les en-têtes d'une action. */
async function appliquerSetCookie(valeur: string) {
  const [paire, ...attrs] = valeur.split(";").map((s) => s.trim());
  const i = paire.indexOf("=");
  const nom = paire.slice(0, i);
  const val = paire.slice(i + 1);
  const opts: Record<string, unknown> = { path: "/" };
  for (const a of attrs) {
    const [k, v] = a.split("=");
    const cle = k.toLowerCase();
    if (cle === "path") opts.path = v;
    else if (cle === "httponly") opts.httpOnly = true;
    else if (cle === "secure") opts.secure = true;
    else if (cle === "samesite") opts.sameSite = (v || "lax").toLowerCase();
    else if (cle === "max-age") opts.maxAge = Number(v);
  }
  const magasin = await cookies();
  if (opts.maxAge === 0) magasin.delete(nom === COOKIE_NAME ? COOKIE_NAME : nom);
  else magasin.set(nom, val, opts as Parameters<typeof magasin.set>[2]);
}

/* ---------------------------------------------------------------- route */

type ContexteNext = { params: Promise<Record<string, string | string[]>> };

export function route(handler: Handler) {
  return async (request: Request, ctx: ContexteNext): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const depart = Date.now();
    const req = requeteDepuis(request);
    const res = new ReponseCapturee();

    /* Configuration validée une fois (mise en cache) : une variable illisible se
       voit dans le journal avec son nom, et le client n'en apprend rien de plus. */
    try { lireConfig(); } catch (err) {
      log.error("boot", "configuration invalide", { erreur: (err as Error).message });
      ligneHttp(request.method, pathname, 503, depart, null);
      return json(503, { error: "configuration du serveur invalide" });
    }

    let user: Utilisateur | null = null;
    try {
      user = (await readSession(readCookie(req))) as Utilisateur | null;
    } catch (err) {
      /* Base injoignable : refuser plutôt que servir sans pouvoir vérifier. */
      log.error("db", "session illisible", { path: pathname, erreur: (err as Error).message });
      ligneHttp(request.method, pathname, 503, depart, null);
      return json(503, { error: "base de données injoignable" });
    }
    if (!user && !OUVERTES.has(pathname)) {
      ligneHttp(request.method, pathname, 401, depart, null);
      return json(401, { error: "authentification requise" });
    }

    const role = roleDemande(user, request.headers.get("x-m3-role") || lireCookie(req.headers.cookie, COOKIE_VOIR_COMME));
    /* Paramètres de segment, dans l'ordre de l'URL, comme la table de routes de
       legacy/server.js les passait (positionnels). */
    const params = Object.values((await ctx?.params) ?? {}).flat().map(decodeURIComponent);

    try {
      const body = await lireCorps(request);
      const contexte: Contexte = { params, query: Object.fromEntries(url.searchParams), body, user, role, req, res };
      /* Contexte de requête : le journal (M3-81) y lit l'auteur d'une action. */
      await requestContext.run({ user, role }, () => handler(contexte));
    } catch (err) {
      const { status, message } = erreurVersStatut(err);
      /* La pile ne part jamais au client — seulement dans le journal. */
      log.error("api", "échec", { methode: request.method, path: pathname, statut: status, erreur: message, pile: (err as Error)?.stack });
      ligneHttp(request.method, pathname, status, depart, user);
      return json(status, { error: message });
    }
    ligneHttp(request.method, pathname, res.status, depart, user);
    return versResponse(res);
  };
}

/* ----------------------------------------------------------- navigation */

/* /auth/login, /auth/callback, /site-icon : ouverts sans session, écrits en
   (req, res, url). Leurs redirections 302 et leurs images passent telles quelles. */
export function navigation(fn: Navigation) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const depart = Date.now();
    const req = requeteDepuis(request);
    const res = new ReponseCapturee();
    try {
      await fn(req, res, url);
    } catch (err) {
      const { status, message } = erreurVersStatut(err);
      log.error("api", "échec", { methode: request.method, path: url.pathname, statut: status, erreur: message, pile: (err as Error)?.stack });
      ligneHttp(request.method, url.pathname, status, depart, null);
      return json(status, { error: message });
    }
    ligneHttp(request.method, url.pathname, res.status, depart, null);
    return versResponse(res);
  };
}

/* --------------------------------------------------------------- action */

export interface AppelAction {
  params?: string[];
  query?: Record<string, string>;
  body?: unknown;
}

/* Le même handler, appelé depuis une action serveur ou un composant serveur.
   Rend le corps JSON décodé ; une réponse ≥ 400 devient une erreur portant
   `status` et `data`. Les cookies posés (connexion, déconnexion) sont appliqués.
   `ouverte` : comme OUVERTES pour route() — sans elle, pas de session = 401. */
export function action<T = unknown>(handler: Handler, { ouverte = false } = {}) {
  return async (appel: AppelAction = {}): Promise<T> => {
    const h = await headers();
    const req = requeteDepuisEnTetes(h);
    const res = new ReponseCapturee();

    let user: Utilisateur | null = null;
    try {
      /* Mémoïsé par requête : la même lecture que le layout et la page. */
      user = await utilisateurCourant();
    } catch (err) {
      log.error("db", "session illisible", { erreur: (err as Error).message });
      throw Object.assign(new Error("base de données injoignable"), { status: 503 });
    }
    if (!user && !ouverte) throw Object.assign(new Error("authentification requise"), { status: 401 });

    const role = roleDemande(user, h.get("x-m3-role") || (await cookies()).get(COOKIE_VOIR_COMME)?.value || null);
    const contexte: Contexte = {
      params: appel.params ?? [], query: appel.query ?? {}, body: appel.body ?? {},
      user, role, req, res,
    };
    await requestContext.run({ user, role }, () => handler(contexte));

    const sc = res.headers.get("set-cookie");
    if (sc) await appliquerSetCookie(sc);

    let data: unknown = {};
    if (typeof res.body === "string" && res.body) {
      try { data = JSON.parse(res.body); } catch { data = { error: res.body }; }
    }
    if (res.status >= 400) {
      const d = data as { error?: string };
      throw Object.assign(new Error(d?.error || `HTTP ${res.status}`), { status: res.status, data });
    }
    return data as T;
  };
}
