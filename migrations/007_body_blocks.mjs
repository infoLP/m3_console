/* 007 — le corps des articles passe en blocs typés, et absorbe le plan Hn.
 *
 * Avant : doc->'body'     = ["paragraphe", "paragraphe", …]
 *         doc->'seo'->'outline' = [{t:"H1",x:…},{t:"H2",x:…}] — jamais relu par
 *         personne, et surtout jamais présent dans le texte.
 *
 * Après : doc->'body'     = [{id,type:"p"|"h2"|"h3",text}, …], intertitres compris,
 *         et `outline` supprimé de `seo` : le plan se dérive du corps.
 *
 * Les intertitres du plan sont réinjectés dans le corps, répartis entre les
 * paragraphes (foldOutlineIntoBody). Le placement est une approximation — l'ordre
 * du plan est la seule information disponible. Choix arbitré le 2026-09-17 :
 * relire les articles anciens et déplacer un intertitre est un geste de seconde,
 * repartir d'un texte plat en aurait demandé la régénération complète.
 *
 * `signs` et `reading` sont recalculés : le texte des intertitres entre désormais
 * dans le décompte. `updated_at` n'est PAS touché — le dater du jour de la
 * migration fausserait les séries du Suivi.
 *
 * Idempotente : un corps déjà en blocs n'est pas retouché.
 */

import { asBlocks, foldOutlineIntoBody } from "../shared/model.js";
import { wordsOf, readingOf } from "../shared/scoring.js";

const alreadyBlocks = (body) =>
  Array.isArray(body) && body.length > 0 && body.every((b) => b && typeof b === "object");

export async function up(client) {
  const { rows } = await client.query("SELECT id, doc FROM articles ORDER BY id");
  let converted = 0, headings = 0;

  for (const { id, doc } of rows) {
    const hadOutline = doc.seo && Object.prototype.hasOwnProperty.call(doc.seo, "outline");
    if (alreadyBlocks(doc.body) && !hadOutline) continue;

    const body = alreadyBlocks(doc.body)
      ? asBlocks(doc.body)
      : foldOutlineIntoBody(doc.body, doc.seo?.outline);

    const seo = { ...(doc.seo || {}) };
    delete seo.outline;

    const next = { ...doc, body, seo };
    headings += body.filter((b) => b.type !== "p").length;
    converted++;

    await client.query(
      "UPDATE articles SET doc = $2::jsonb, signs = $3, reading = $4 WHERE id = $1",
      [id, JSON.stringify(next), wordsOf(next), readingOf(next)]
    );
  }

  /* Le compte part dans les logs de démarrage du conteneur : sans lui, une
     migration qui ne convertit rien (mauvais format en base, table vide) est
     indiscernable d'une migration réussie. */
  console.log(`  007 : ${converted}/${rows.length} article(s) convertis, ${headings} intertitre(s) placés dans le corps`);
}
