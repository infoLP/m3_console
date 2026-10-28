/* Sites concurrents (M3-120) : handlers de l'onglet Sources → Concurrents du
   back-office, réservés au droit `manage_competitors` (administrateur et
   superutilisateur) ; 403 pour tout autre rôle. La règle est dans
   src/lib/competitors.js.
   M3-122 : le scan (bouton « Lancer le scan », bandeau d'état) et les domaines
   candidats qu'il trouve. Le moteur est celui de M3-121
   (src/ingest/competitorScan.js) : runCompetitorScan, listCandidates,
   setCandidateStatus, scanState. */

import { send } from "../lib/http.js";
import { journal } from "../lib/journal.js";
import { log } from "../lib/log.js";
import { pushCollection } from "../lib/store.js";
import { can } from "../../shared/model.js";
import { createCompetitors } from "../lib/competitors.js";
import * as competitorScan from "../ingest/competitorScan.js";

export const competitors = createCompetitors();

export const STATUTS_CANDIDAT = ["nouveau", "propose", "ajoute", "ecarte"];
const LIMITE_CANDIDATS = 200;
/* Le temps laissé au moteur pour dire « verrou pris » avant de répondre. */
const ATTENTE_VERROU_MS = 50;

const reserve = (role) => !can(role, "manage_competitors");
const refus = (res) => send(res, 403, { error: "réservé à l'administrateur et au superutilisateur" });
const qui = (user) => user?.name || user?.login || null;
const DEJA_EN_COURS = "Un scan des concurrents est déjà en cours.";

const trace = (event, c) => journal("action", event, { target: c.label, detail: { site: c.url, actif: c.active } });
const traceCandidat = (event, c, detail = {}) =>
  journal("action", event, { target: c.domain, detail: { domaine: c.domain, statut: c.status, ...detail } });

/* La demande d'ajout (onglet Demandes) qu'un « Proposer » crée : les champs d'un
   ticket de la console (meta.createTicket), et qui cite le domaine en note. */
export function demandeDepuisCandidat(c, user, maintenant = new Date()) {
  const cites = (c.competitors || []).map((x) => x.label).filter(Boolean);
  return {
    id: `tk-${maintenant.getTime()}`,
    kind: "ajout_source",
    label: c.domain,
    url: `https://${c.domain}`,
    note: `Domaine cité ${c.occurrences} fois par les concurrents${cites.length ? ` (${cites.join(", ")})` : ""}. Proposé depuis Sources → Concurrents.`,
    origin: "concurrents",
    candidateId: c.id,
    requestedBy: qui(user) || "superutilisateur",
    requestedById: user?.id || null,
    status: "ouvert",
    at: maintenant.toISOString(),
  };
}

/* `service` : injectable pour les tests (dépôt en mémoire) ; `scan` : le moteur
   de M3-121 ; `tickets` : où va la demande d'un « Proposer ». */
export function handlers(service = competitors, { scan = competitorScan, tickets = { push: (t) => pushCollection("tickets", t) } } = {}) {
  return {
    async list({ res, role }) {
      if (reserve(role)) return refus(res);
      send(res, 200, { competitors: await service.list() });
    },

    async create({ res, role, body, user }) {
      if (reserve(role)) return refus(res);
      const c = await service.create(body || {}, { by: qui(user) });
      trace("Concurrent ajouté", c);
      send(res, 200, { ok: true, competitor: c });
    },

    async update({ res, role, params, body }) {
      if (reserve(role)) return refus(res);
      const c = await service.update(params[0], body || {});
      trace("Concurrent modifié", c);
      send(res, 200, { ok: true, competitor: c });
    },

    async activate({ res, role, params, body }) {
      if (reserve(role)) return refus(res);
      const c = await service.setActive(params[0], body?.active !== false);
      trace(c.active ? "Concurrent réactivé" : "Concurrent désactivé", c);
      send(res, 200, { ok: true, competitor: c });
    },

    async remove({ res, role, params }) {
      if (reserve(role)) return refus(res);
      const r = await service.remove(params[0]);
      journal("action", "Concurrent retiré", { target: r.label, detail: { site: r.url } });
      send(res, 200, { ok: true, ...r });
    },

    /* ------------------------------------------------- scan (M3-122) */

    async scanStatus({ res, role }) {
      if (reserve(role)) return refus(res);
      send(res, 200, { scan: await scan.scanState() });
    },

    /* Non bloquant : la réponse part tout de suite, le scan tourne derrière. Un
       scan déjà en cours → 409, qu'il se voie dans l'état ou au verrou : le
       moteur rend aussitôt { skipped: "busy" } quand le verrou est pris, sinon
       sa promesse ne se résout qu'en fin de scan, et on ne l'attend pas. */
    async launchScan({ res, role, user }) {
      if (reserve(role)) return refus(res);
      const etat = await scan.scanState();
      if (etat?.running) return send(res, 409, { error: DEJA_EN_COURS });
      const lance = Promise.resolve().then(() => scan.runCompetitorScan({ trigger: "manuel", by: qui(user) }));
      const tot = await Promise.race([
        lance.then((r) => ({ r }), (e) => ({ e })),
        new Promise((ok) => setTimeout(() => ok(null), ATTENTE_VERROU_MS)),
      ]);
      if (tot?.r?.skipped === "busy") return send(res, 409, { error: DEJA_EN_COURS });
      if (tot?.e) return send(res, tot.e.status || 500, { error: tot.e.status ? tot.e.message : "le scan n'a pas pu démarrer" });
      if (!tot) lance.catch((e) => log.error("concurrents", "scan manuel en échec", { error: e?.message }));
      journal("action", "Scan des concurrents lancé", { target: "concurrents", detail: { declenchement: "manuel" } });
      send(res, 202, { ok: true, started: true });
    },

    /* --------------------------------------- domaines candidats (M3-122) */

    async candidates({ res, role, query }) {
      if (reserve(role)) return refus(res);
      const status = query?.status || "nouveau";
      if (!STATUTS_CANDIDAT.includes(status)) return send(res, 400, { error: `statut inconnu : ${status}` });
      send(res, 200, { status, candidates: await scan.listCandidates({ status, limit: LIMITE_CANDIDATS }) });
    },

    async discard({ res, role, params, user }) {
      if (reserve(role)) return refus(res);
      const c = await scan.setCandidateStatus(params[0], "ecarte", qui(user));
      traceCandidat("Domaine candidat écarté", c);
      send(res, 200, { ok: true, candidate: c });
    },

    /* Superutilisateur : une demande d'ajout de source pour l'administrateur
       (onglet Demandes), puis le candidat passe à « proposé ». L'administrateur,
       lui, crée la source directement (adopt). */
    async propose({ res, role, params, user }) {
      if (reserve(role)) return refus(res);
      const c = await scan.setCandidateStatus(params[0], "propose", qui(user));
      const t = demandeDepuisCandidat(c, user);
      try {
        await tickets.push(t);
      } catch (e) {
        await scan.setCandidateStatus(params[0], "nouveau", qui(user)).catch(() => {});
        throw e;
      }
      traceCandidat("Domaine candidat proposé", c, { ticket: t.id });
      send(res, 200, { ok: true, candidate: c, ticket: t });
    },

    /* Administrateur seulement (manage_sources). Appelé à l'enregistrement
       effectif de la source ouverte par « Créer la source » (/admin?candidat=),
       pas au clic : un formulaire abandonné ne laisse pas de faux « ajouté ». */
    async adopt({ res, role, params, user }) {
      if (!can(role, "manage_sources")) return send(res, 403, { error: "réservé à l'administrateur" });
      const c = await scan.setCandidateStatus(params[0], "ajoute", qui(user));
      traceCandidat("Domaine candidat ajouté aux sources", c);
      send(res, 200, { ok: true, candidate: c });
    },
  };
}

export const { list, create, update, activate, remove, scanStatus, launchScan, candidates, discard, propose, adopt } = handlers();
