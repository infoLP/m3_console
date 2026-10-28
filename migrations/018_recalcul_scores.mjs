/* 018 — les scores du stock sont recalculés avec la grille alignée de M3-113.
 *
 * La grille a changé (M3-113) : signs_min retiré au profit de breve_signs_min,
 * crédit de l'illustration exigé, bande « fort » à 80. `doc->'scores'` est
 * écrit à la génération et relu tel quel par la liste de la console : sans
 * reprise, la liste et la fiche ouverte (qui recalcule à l'affichage)
 * donneraient deux notes pour le même article.
 *
 * Même calcul que `npm run rescore` (src/tools/rescore.js), mais avec le
 * `client` de la migration : réglages lus en base par settingsFromRows (pur),
 * pas par readSettings, qui passe par le pool. `zoneClass` n'est pas repris :
 * la couverture n'a pas changé, `npm run rescore` reste là pour ça.
 *
 * `updated_at` / `updatedAt` ne sont PAS touchés, comme en 007 : les dater du
 * jour de la migration fausserait les séries du Suivi.
 *
 * Idempotente : un score déjà égal (à l'ordre des clés près, jsonb les
 * réordonne) n'est pas réécrit.
 */

import { settingsFromRows } from "../src/lib/yamlStore.js";
import { recalculerScores } from "../shared/scoring.js";

/* Copie de `stable` / `scoresEqual` de src/tools/rescore.js : importer ce module
   tirerait store.js et le pool dans la migration. Les tableaux ne sont pas
   triés, leur ordre porte du sens. */
const stable = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}"
    : Array.isArray(v)
      ? "[" + v.map(stable).join(",") + "]"
      : JSON.stringify(v);
const scoresEqual = (a, b) => stable(a) === stable(b);

export async function up(client) {
  const { rows: reglages } = await client.query("SELECT key, value FROM settings");
  const { settings } = settingsFromRows(reglages);
  const { rows } = await client.query("SELECT id, doc FROM articles ORDER BY id");
  let changed = 0;

  for (const { id, doc } of rows) {
    const scores = recalculerScores(doc, settings);
    if (scoresEqual(doc.scores || null, scores)) continue;
    changed++;
    await client.query(
      "UPDATE articles SET doc = jsonb_set(doc, '{scores}', $2::jsonb) WHERE id = $1",
      [id, JSON.stringify(scores)]
    );
  }

  /* Le compte part dans les logs de démarrage du conteneur (cf. 007). */
  console.log(`  018 : ${changed}/${rows.length} article(s) rescorés avec la grille M3-113`);
}
