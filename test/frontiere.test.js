/* T26 — frontière de la console : aucun morceau du moteur ici. Le moteur (M3)
   récolte, génère, publie, planifie et joue les migrations ; la console dépose
   des demandes dans `jobs` et lit la base (shared/contrat.js). Ce test refuse :
   - les dossiers et modules du moteur, s'ils réapparaissent ;
   - tout import qui y mène, depuis n'importe quel fichier, tests (*.test.*)
     compris : un test qui importe le moteur le fait revenir par la bande ;
   - les dépendances du moteur dans package.json. */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const posix = (p) => p.split(sep).join("/");

/* Chemins du moteur, relatifs à la racine. Un dossier interdit tout ce qu'il
   contient. */
const MOTEUR = [
  "src/ingest", "src/generate", "src/publish", "src/llm", "src/schedule", "src/jobs", "src/tools",
  "src/lib/main.js", "src/lib/runLock.js", "src/lib/routineContext.js",
  "migrations",
];
const DEPENDANCES_MOTEUR = ["playwright", "playwright-core", "crawlee", "rss-parser", "pdf-parse", "cheerio", "xlsx"];

const DOSSIERS = ["src", "shared", "outils-console", "scripts", "test"];
const EXTENSIONS = /\.(m?js|cjs|tsx?)$/;

function fichiers(dossier) {
  const out = [];
  if (!existsSync(dossier)) return out;
  for (const nom of readdirSync(dossier)) {
    const p = join(dossier, nom);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (EXTENSIONS.test(nom)) out.push(p);
  }
  return out;
}

/* Spécificateurs : import/export … from "x", import "x", import("x"), require("x"),
   new URL("x", import.meta.url). */
const SPECS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']/g,
  /new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g,
];
function specificateurs(source) {
  const out = new Set();
  for (const re of SPECS) for (const m of source.matchAll(re)) out.add(m[1]);
  return [...out];
}

/* Chemin du moteur écrit en dur, relatif à src/ ou non (mock.module(new URL(
   "ingest/harvestRun.js", root)) des tests de câblage). Fichiers de code
   seulement : les clés kv du contrat (« llm/spend.json ») ne sont pas visées. */
const EN_DUR = /["'](?:\.\.?\/)*(?:src\/)?((?:ingest|generate|publish|llm|schedule|jobs|tools)\/[\w./-]+\.(?:m?js|tsx?)|lib\/(?:main|runLock|routineContext)\.js)["']/g;

const versMoteur = (chemin) => MOTEUR.find((m) => chemin === m || chemin.startsWith(m + "/") || chemin === m.replace(/\.js$/, ""));
const paquet = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

test("frontière : aucun dossier ni module du moteur dans la console", () => {
  const presents = MOTEUR.filter((m) => existsSync(join(RACINE, m)));
  assert.deepEqual(presents, [], "à supprimer : le moteur vit dans M3");
});

test("frontière : aucun import vers le moteur, tests compris", () => {
  /* Ce fichier-ci cite le moteur en exemple : hors relevé. */
  const tous = DOSSIERS.flatMap((d) => fichiers(join(RACINE, d))).filter((f) => f !== fileURLToPath(import.meta.url));
  assert.ok(tous.some((f) => /\.test\.(js|ts)$/.test(f)), "le relevé couvre les *.test.*");
  const fautes = [];
  for (const f of tous) {
    const src = readFileSync(f, "utf8");
    for (const spec of specificateurs(src)) {
      if (spec.startsWith(".")) {
        const cible = posix(relative(RACINE, resolve(dirname(f), spec)));
        const m = versMoteur(cible);
        if (m) fautes.push(`${posix(relative(RACINE, f))} → ${spec} (${m})`);
      } else if (DEPENDANCES_MOTEUR.includes(paquet(spec))) {
        fautes.push(`${posix(relative(RACINE, f))} → ${spec} (dépendance du moteur)`);
      }
    }
    for (const m of src.matchAll(EN_DUR)) fautes.push(`${posix(relative(RACINE, f))} → "${m[1]}" (chemin du moteur en dur)`);
  }
  assert.deepEqual(fautes, [], "passer par une demande (src/lib/demandes.js) ou une lecture en base");
});

test("frontière : package.json sans dépendance du moteur", () => {
  const pkg = JSON.parse(readFileSync(join(RACINE, "package.json"), "utf8"));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
  assert.deepEqual(deps.filter((d) => DEPENDANCES_MOTEUR.includes(d)), []);
});

/* Garde du relevé lui-même : un import vers le moteur, sous chacune des formes
   reconnues, est bien vu. Sans lui, une regex cassée laisserait tout passer. */
test("frontière : le relevé reconnaît chaque forme d'import", () => {
  const exemple = [
    `import { a } from "../src/llm/index.js";`,
    `export { b } from "../src/jobs/queue.js";`,
    `import "../src/schedule/scheduler.js";`,
    `const c = await import("../src/publish/index.js");`,
    `mock.module(new URL("ingest/harvestRun.js", import.meta.url).href, {});`,
  ].join("\n");
  assert.deepEqual(specificateurs(exemple).sort(), [
    "../src/jobs/queue.js", "../src/llm/index.js", "../src/publish/index.js", "../src/schedule/scheduler.js", "ingest/harvestRun.js",
  ]);
  assert.equal(versMoteur("src/lib/runLock.js"), "src/lib/runLock.js");
  assert.deepEqual([...`new URL("ingest/harvestRun.js", root); kv.get("llm/spend.json"); "lib/runLock.js"`.matchAll(EN_DUR)].map((m) => m[1]),
    ["ingest/harvestRun.js", "lib/runLock.js"]);
  assert.equal(versMoteur("src/lib/store.js"), undefined);
});
