/* Recalcule `article.scores` sur tout le stock, sans rien modifier d'autre.
 *
 *   npm run rescore            → applique
 *   npm run rescore -- --dry   → liste ce qui changerait, n'écrit rien
 *   npm run rescore -- --all   → réécrit tout, y compris les scores inchangés
 *                                (recalcule aussi les colonnes signs/reading)
 *
 * À lancer après toute évolution des règles de scoring. Sans cela, la liste de
 * la console (qui lit `scores` tel qu'il a été écrit au moment de la génération)
 * et la fiche ouverte (qui recalcule à l'affichage) donnent deux notes
 * différentes pour le même article — le premier symptôme visible étant les pips
 * de conformité verts sur un article qui affiche 4/5 une fois ouvert.
 *
 * `updatedAt` n'est pas touché : voir writeArticle({ touch }).
 */

import { listArticleIds, readArticle, writeArticle } from "../lib/store.js";
import { readSettings } from "../lib/yamlStore.js";
import { scoreSummary } from "../../shared/scoring.js";
import { zoneClassOf } from "../../shared/model.js";
import { coveredOf } from "../../shared/zones.js";
import { closePool } from "../lib/db.js";
import { isMain } from "../lib/main.js";

/* Sérialisation à clés triées, pour comparer deux scores.
 *
   POURQUOI PAS JSON.stringify DIRECTEMENT. `doc` est stocké en jsonb, et
   PostgreSQL y réordonne les clés — par longueur, puis par octets. Un score
   relu depuis la base sort donc dans un ordre qui n'est pas celui que produit
   `scoreSummary` :

     stocké    : seo, ready, editorial, conformity, editorialBand
     recalculé : editorial, editorialBand, seo, conformity, ready

   Les deux chaînes ne coïncidaient jamais, même à valeurs identiques : l'outil
   annonçait tout le stock à reprendre à chaque passage, et `--dry` ne valait
   plus comme signal. Le défaut date de la bascule PostgreSQL — du temps des
   fichiers YAML, l'ordre était préservé et la comparaison directe suffisait.

   Les tableaux ne sont PAS triés : leur ordre porte du sens (l'ordre des blocs
   du corps, celui des mots-clés), et le confondre masquerait un vrai changement. */
const stable = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}"
    : Array.isArray(v)
      ? "[" + v.map(stable).join(",") + "]"
      : JSON.stringify(v);

/* Deux scores portent-ils les mêmes valeurs, quel que soit l'ordre des clés ? */
export const scoresEqual = (a, b) => stable(a) === stable(b);

export async function rescore({ dry = false, all = false, log = console.log } = {}) {
  const settings = await readSettings();
  const covered = coveredOf(settings);
  const ids = await listArticleIds();
  let changed = 0;

  for (const id of ids) {
    const a = await readArticle(id);
    if (!a) continue;
    const after = scoreSummary(a, settings);
    /* La classe de zone suit la couverture (M3-77) : elle est enregistrée à
       l'écriture, et cocher ou décocher un département au back-office doit
       reclasser le stock — c'est le même geste que pour un seuil de notation. */
    const zoneClass = zoneClassOf(a.zone, covered);
    const zoneMoved = zoneClass !== a.zoneClass;
    /* `--all` réécrit même quand le score est identique : les colonnes `signs` et
       `reading` sont calculées par writeArticle, et elles seules bougent quand le
       corps change de forme sans changer de note. */
    if (!all && !zoneMoved && scoresEqual(a.scores || null, after)) continue;
    changed++;
    const b = a.scores?.conformity, n = after.conformity;
    log(`  ${id} — conformité ${b ? `${b.passed}/${b.total}` : "—"} → ${n.passed}/${n.total}` +
      `, SEO ${a.scores?.seo || "—"} → ${after.seo}` + (zoneMoved ? `, zone ${a.zoneClass || "—"} → ${zoneClass}` : ""));
    if (dry) continue;
    a.scores = after;
    a.zoneClass = zoneClass;
    await writeArticle(a, { touch: false });
  }
  return { total: ids.length, changed };
}

if (isMain(import.meta.url)) {
  const dry = process.argv.includes("--dry");
  rescore({ dry, all: process.argv.includes("--all") })
    .then((r) => log(r, dry))
    .catch((e) => { console.error("✗ " + e.stack); process.exitCode = 1; })
    .finally(() => closePool());
}

function log({ total, changed }, dry) {
  if (changed === 0) return console.log(`✓ ${total} articles, aucun score à reprendre`);
  console.log(dry
    ? `→ ${changed} article(s) sur ${total} verraient leur score changer (essai à blanc, rien écrit)`
    : `✓ ${changed} article(s) sur ${total} rescorés`);
}
