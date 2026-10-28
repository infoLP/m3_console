import { send } from "../lib/http.js";
import { readArticle, writeArticle, readIndex, readHistory, pushCollection, clearArticles } from "../lib/store.js";
import { readSettings } from "../lib/yamlStore.js";
import { scoreSummary } from "../../shared/scoring.js";
import { zoneClassOf, STATUS_ORDER, can, asBlocks, writtenByMock, MOCK_PUBLISH_REFUSAL } from "../../shared/model.js";
import { enqueue, attendreJob } from "../lib/demandes.js";
import { coveredOf } from "../../shared/zones.js";
import { illustrationMissing, ILLUSTRATION_REFUSAL, featsFor } from "../../shared/feats.js";

const EDITABLE = new Set([
  "title", "chapo", "signature", "body", "cat", "ranking", "rankingReason",
  "zone", "source", "illustration", "seo", "reviewer",
]);

/* Les quatre filtres et la pagination partent en SQL. La réponse gagne `total`
   et `nextCursor` ; `generated_at` et `articles` ne bougent pas.

   Un appel sans `limit` rend au plus INDEX_LIMIT_DEFAULT articles : à 5 000
   articles, l'ancienne réponse complète pèsera 6 Mo par ouverture de console. */
export async function list({ res, query }) {
  send(res, 200, await readIndex({
    status: query.status,
    zone: query.zone,
    source: query.source,
    since: query.since,
    limit: query.limit,
    cursor: query.cursor,
  }));
}

export async function get({ res, params }) {
  const a = await readArticle(params[0]);
  if (!a) return send(res, 404, { error: "article introuvable" });
  send(res, 200, a);
}

/* Un article purgé (M3-79) se consulte, il ne se modifie plus : il est sorti du
   travail, et le rouvrir passerait par une nouvelle génération. */
const purged = (a, res) => a.status === "purge" && (send(res, 409, { error: "article purgé : consultation seule" }), true);

export async function patch({ res, params, body, role }) {
  const a = await readArticle(params[0]);
  if (!a) return send(res, 404, { error: "article introuvable" });
  if (purged(a, res)) return;
  const settings = await readSettings();

  for (const [k, v] of Object.entries(body || {})) {
    if (!EDITABLE.has(k)) continue;
    if (k === "ranking") a.ranking = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    /* Le corps repasse par asBlocks : il vient du navigateur, et un type de bloc
       inconnu se retrouverait sinon tel quel dans le HTML publié. */
    else if (k === "body") a.body = asBlocks(v);
    else if (k === "zone") a.zone = { ...a.zone, ...v };
    else if (k === "source") a.source = { ...a.source, ...v };
    else if (k === "illustration") a.illustration = v ? { ...(a.illustration || {}), ...v } : null;
    /* `outline` est ignoré s'il arrive encore : le plan est dérivé du corps, et
       le réaccepter ici recréerait le champ fantôme qu'on vient de supprimer. */
    else if (k === "seo") { const { outline, ...seo } = v || {}; a.seo = { ...a.seo, ...seo }; }
    else a[k] = v;
  }
  /* Illustration obligatoire (M3-93) : un article validé — parution programmée
     comprise — ne perd pas son image après coup, sinon le planificateur
     (scheduler.js, publishDue) le publierait sans revérifier. Seule une
     modification de l'illustration est refusée : un article validé avant que le
     seuil soit monté reste modifiable pour le reste. */
  if (a.status === "valide" && body && "illustration" in body && illustrationMissing(a, role, settings))
    return send(res, 409, { code: "illustration", error: `${ILLUSTRATION_REFUSAL} L'article est déjà validé : remettez-le dans la file pour retirer son image.` });
  a.zoneClass = zoneClassOf(a.zone, coveredOf(settings));
  a.scores = scoreSummary(a, settings);
  await writeArticle(a);
  send(res, 200, a);
}

/* Statuts qui constituent une décision éditoriale : ceux que l'onglet Historique
   doit pouvoir dater et attribuer. « archive » EST le refus — il n'existe pas de
   statut « refusé » distinct (cf. STATUSES dans shared/model.js). */
const DECIDED = new Set(["valide", "publie", "archive"]);

/* Trace de décision posée sur le document. La PERSONNE est prise de la session,
   jamais de la requête : la console envoyait jusqu'ici le libellé de son rôle
   (« Administrateur »), ce qui rendait `reviewer` inutilisable. `byRole` garde à
   côté le rôle effectif, « Voir comme » compris, pour expliquer un droit exercé. */
function decisionOf(status, user, role) {
  return {
    status,
    at: new Date().toISOString(),
    byId: user?.id || null,
    byName: user?.name || null,
    byLogin: user?.login || null,
    byRole: role || user?.role || null,
  };
}

export async function setStatus({ res, params, body, role, user }) {
  const a = await readArticle(params[0]);
  if (!a) return send(res, 404, { error: "article introuvable" });
  if (purged(a, res)) return;
  const next = String(body.status || "");
  if (!STATUS_ORDER.includes(next)) return send(res, 400, { error: "statut inconnu" });
  if ((next === "publie") && !can(role, "publish")) return send(res, 403, { error: "droit de publication requis" });
  // texte du mock (M3-84) : ni validé ni publié, il se régénère ; le classer reste possible
  if ((next === "valide" || next === "publie") && writtenByMock(a)) return send(res, 409, { error: MOCK_PUBLISH_REFUSAL });
  // illustration obligatoire sous le seuil de la FEAT (M3-93) — mêmes statuts que la parution
  if ((next === "valide" || next === "publie") && illustrationMissing(a, role, await readSettings()))
    return send(res, 409, { code: "illustration", error: ILLUSTRATION_REFUSAL });

  a.status = next;
  if (DECIDED.has(next)) {
    a.decision = decisionOf(next, user, role);
    /* `reviewer` porte désormais le NOM de la personne, et non plus le libellé du
       rôle : c'est ce champ qu'agrège « Activité par relecteur » dans le Suivi. */
    a.reviewer = user?.name || body.reviewer || a.reviewer || null;
  } else {
    /* Remis dans la file : il n'y a plus de décision. La laisser en place ferait
       réapparaître l'article dans l'Historique alors qu'il est de nouveau à relire.
       On RETIRE la clé plutôt que de la mettre à null : en jsonb, un null est une
       valeur, et `doc->'decision' IS NULL` — la condition qu'emploie la reprise de
       la migration 003 — ne le verrait pas comme une absence. */
    delete a.decision;
  }
  await writeArticle(a);
  await pushCollection("runs", { id: `run-${Date.now()}`, kind: "status", at: new Date().toISOString(), stats: { article: a.id, status: next, role } });
  send(res, 200, a);
}

/* Régénération (T19c) : refus préalables ici, le travail dans le worker
   (demande « regenerate », src/jobs/taches/regenerate.js dans M3). 202 + la
   demande ; le navigateur la suit (lireDemande). `updatedAt` part avec la
   demande : le moteur n'écrase pas un article modifié entre-temps. */
export async function regenerate({ res, params, body, user }) {
  const a = await readArticle(params[0]);
  if (!a) return send(res, 404, { error: "article introuvable" });
  if (purged(a, res)) return;
  const settings = await readSettings();
  /* Hors zone (M3-85) : régénérer, c'est payer un article qu'on ne publiera pas.
     Refusé sauf confirmation explicite (`force`) — le relecteur peut avoir une
     raison, la console la lui demande. Sans objet si l'administrateur a choisi de
     générer hors zone. Aucune demande déposée avant ce contrôle. */
  if (!body.force && settings.generate_out_of_zone !== "oui" && zoneClassOf(a.zone, coveredOf(settings)) === "nonhab") {
    return send(res, 409, { code: "hors_zone", error: "Sujet hors des zones couvertes : classez-le sans diffusion plutôt que de payer une nouvelle génération." });
  }
  const job = await enqueue("regenerate", { articleId: a.id, altPrompt: body.altPrompt || null, updatedAt: a.updatedAt || null }, user);
  send(res, 202, { ok: true, job });
}

/* Publication (T19c) : refus préalables ici, l'envoi dans le worker (demande
   « publish », voie « articles » : elle n'attend pas derrière une génération).
   Le moteur refait les refus et refuse un article déjà publié : un second clic
   n'envoie pas deux fois. 202 + la demande ; le navigateur la suit. */
export async function publish({ res, params, body, role, user }) {
  const a = await readArticle(params[0]);
  if (!a) return send(res, 404, { error: "article introuvable" });
  if (purged(a, res)) return;
  if (!can(role, "publish")) return send(res, 403, { error: "droit de publication requis" });
  if (writtenByMock(a)) return send(res, 409, { error: MOCK_PUBLISH_REFUSAL });
  const settings = await readSettings();
  if (illustrationMissing(a, role, settings)) return send(res, 409, { code: "illustration", error: ILLUSTRATION_REFUSAL });
  if (a.publication?.wpId) {
    return send(res, 409, { error: `Cet article a déjà été envoyé sur WordPress (n° ${a.publication.wpId}) : le modifier ou le retirer côté WordPress.` });
  }
  const par = user ? { id: user.id || null, name: user.name || null, login: user.login || null, role: user.role || null } : null;
  const job = await enqueue("publish", {
    articleId: a.id, targetId: body.targetId ?? null, scheduledAt: body.scheduledAt || null, user: par, role,
  }, user);
  send(res, 202, { ok: true, job });
}

/* Déposée au worker, qui l'exécute sous le verrou « chain » (M3-58) : cf.
   ops.harvest. 202 + la demande ; le front suit GET /api/runs. */
export async function runGenerate({ res, body, user }) {
  const job = await enqueue("generate", { limit: Number(body.limit) || 0, altPrompt: body.altPrompt || null }, user);
  send(res, 202, { ok: true, job });
}

/* Purge tous les articles générés depuis le back-office. Réservé à l'administrateur.
   Le référentiel de sources et le dernier harvest sont conservés (le harvest est
   réarmé sauf si body.rearm === false), pour pouvoir relancer une génération.
   T14 : réarmer ne fait plus régénérer un contenu déjà généré, sauf
   body.allowRegen === true (case « autoriser la régénération », décochée par défaut). */
export async function purgeArticles({ res, body, role, user }) {
  if (!can(role, "manage_sources")) return send(res, 403, { error: "réservé à l'administrateur" });
  // conservés et attribués (M3-79) : la personne vient de la session, le rôle est l'effectif
  const allowRegen = body.allowRegen === true;
  const r = await clearArticles({ rearmHarvest: body.rearm !== false, by: { ...user, role }, allowRegen });
  await pushCollection("runs", {
    id: `run-${Date.now()}`, kind: "purge", at: new Date().toISOString(),
    stats: { removed: r.removed, rearmed: r.rearmed, harvestDate: r.harvestDate, allowRegen, role },
  });
  send(res, 200, { ok: true, ...r, allowRegen });
}

/* Recalcule les scores stockés sur tout le stock — `npm run rescore` depuis le
   back-office. Utile après un changement des seuils (onglet Paramètres) : la
   liste de la console lit le score écrit à la génération, la fiche le recalcule
   à l'affichage, et les deux divergent tant que le stock n'est pas repris.
   Même fonction que l'outil en ligne de commande, exécutée par le worker
   (demande « rescore », T19c), qui trace le run. Attendue ici (quelques
   secondes) ; au-delà, 504 : la demande continue, résultat dans les dernières.
   Sans danger : seul `scores` est réécrit, `updatedAt` n'est pas touché. */
export async function rescoreArticles({ res, role, user }) {
  if (!can(role, "manage_sources")) return send(res, 403, { error: "réservé à l'administrateur" });
  const job = await enqueue("rescore", { role }, user);
  const fini = await attendreJob(job.id, { delaiMs: 60_000 });
  if (fini.error) return send(res, 502, { error: fini.error });
  send(res, 200, { ok: true, ...(fini.result || {}) });
}

/* Onglet Historique : les articles publiés, en attente de parution et archivés,
   datés et attribués.

   Visible par les trois rôles, mais le NOM du décideur ne l'est pas : seuls les
   comptes qui ont déjà le droit de consulter les statistiques (administrateur et
   super utilisateur — cf. PERMISSIONS.view_stats) voient qui a tranché. Le
   masquage se fait ici, pas à l'affichage : une donnée retirée côté client reste
   lisible dans la réponse réseau.

   `role` est le rôle EFFECTIF : un administrateur en « Voir comme relecteur »
   voit donc l'écran tel que le voit un relecteur, ce qui est tout l'intérêt.

   Les articles purgés suivent la FEAT « Articles purgés dans l'Historique »
   (M3-97) : sous le seuil, la requête ne les lit pas — la même raison que pour
   le nom du décideur. */
export async function history({ res, query: params, role }) {
  const withPurged = featsFor(role, await readSettings()).historiquePurges;
  const data = await readHistory({
    category: params.category,
    q: params.q,
    limit: params.limit,
    cursor: params.cursor,
    withPurged,
    // T14 : un UUID retrouve l'article, ou la fiche de l'article effacé
    uuid: params.uuid,
  });

  const reveal = can(role, "view_stats");
  send(res, 200, {
    items: reveal ? data.items : data.items.map(mask),
    total: data.total,
    counts: data.counts,
    nextCursor: data.nextCursor,
    canSeeAuthors: reveal,
    canSeePurged: withPurged,
  });
}

function mask(row) {
  const out = { ...row, decidedBy: null, decidedById: null, decidedByRole: null };
  /* Fiche d'un article effacé (T14) : les noms y figurent aussi, dans la purge et
     dans chaque décision de la chaîne. */
  if (row.fiche) {
    out.fiche = {
      ...row.fiche, purgedBy: null, erasedBy: null,
      decisions: row.fiche.decisions.map((d) => ({ ...d, byId: null, byName: null, byLogin: null, byRole: null })),
    };
  }
  return out;
}
