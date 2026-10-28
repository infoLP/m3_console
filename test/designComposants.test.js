/* Primitives (src/composants/composants.css) contre la remise à zéro des boutons
   de styles/base.css : `.cr button{border:none;background:none;color:inherit}`
   pèse (0,1,1) et bat toute règle d'une seule classe. Chaque règle qui vise un
   élément <button> d'une primitive doit donc être préfixée par `.cr ` (0,2,0) —
   sinon un Bouton primaire ou danger s'affiche sans fond (constaté sur M3-106). */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/composants/composants.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const base = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");

/* Classes posées sur un <button> par les primitives (Bouton, Message, Tiroir, Tuile). */
const SUR_BOUTON = /\.ui-(bouton(?!-roue)[\w-]*|message-fermer|tiroir-fermer|tuile--bouton)\b/;

function selecteurs(texte) {
  const out = [];
  for (const m of texte.matchAll(/([^{}@]+)\{/g)) for (const s of m[1].split(",")) out.push(s.trim());
  return out.filter(Boolean);
}

test("base.css remet toujours les boutons à zéro sous .cr (sinon ce test n'a plus d'objet)", () => {
  assert.match(base, /\.cr button\{[^}]*background:none/);
});

test("toute règle de primitive posée sur un <button> est préfixée par .cr", () => {
  const fautifs = selecteurs(css).filter((s) => SUR_BOUTON.test(s) && !s.startsWith(".cr "));
  assert.deepEqual(fautifs, [], `sélecteurs trop faibles face à .cr button : ${fautifs.join(" ; ")}`);
});

test("les variantes qui posent un fond existent bien, préfixées", () => {
  for (const v of ["primaire", "secondaire", "danger"]) assert.match(css, new RegExp(`\.cr \.ui-bouton--${v}\{[^}]*background:`));
  assert.match(css, /\.cr \.ui-tuile--bouton\{[^}]*background:/);
});

/* La remise à zéro universelle doit rester SOUS les utilitaires Tailwind : hors
   couche, elle annulait p-2, mt-3… (constaté sur M3-109). */
test("reset universel dans @layer base, ordre theme < base < utilities déclaré avant tout", () => {
  const b = base.replace(/\/\*[\s\S]*?\*\//g, "");
  const premiere = b.match(/@layer\s+([^;{]+);/);
  assert.ok(premiere, "déclaration d'ordre des couches absente de base.css");
  assert.deepEqual(premiere[1].split(",").map((s) => s.trim()), ["theme", "base", "utilities"]);
  assert.ok(b.indexOf(premiere[0]) < b.indexOf("@layer base{"), "l'ordre doit précéder le premier bloc @layer");
  assert.doesNotMatch(b.replace(/@layer base\{[\s\S]*?\n\}/, ""), /^\*\{[^}]*(margin|padding):0/m, "un reset * hors couche subsiste");
});

/* Tiroir : rendu par portail, sinon il hérite du contexte d'empilement de la coque
   (z-index 1) et passe sous la navigation (z-index 3). */
test("Tiroir en portail vers un conteneur .cr, z-index entre navigation et toast", () => {
  const tiroir = readFileSync(new URL("../src/composants/Tiroir.tsx", import.meta.url), "utf8");
  assert.match(tiroir, /createPortal\(/);
  assert.match(tiroir, /className = "cr ui-portail"/);
  const z = Number(css.match(/\.ui-tiroir-voile\{[^}]*z-index:(\d+)/)[1]);
  assert.ok(z > 3 && z < 60, `z-index du voile hors de ]3,60[ : ${z}`);
  assert.match(css, /\.cr\.ui-portail\{[^}]*min-height:0/);
});
