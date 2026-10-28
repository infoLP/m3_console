/* `npm run check` (T29) : typecheck, lint et tests EN PARALLÈLE (indépendants,
   chacun sur son cœur), puis la compilation de production si les trois sont
   verts. `--rapide` s'arrête avant la compilation (`npm run check:rapide`).

   Sortie de chaque étape tamponnée puis affichée d'un bloc, dans l'ordre des
   étapes, pour rester lisible ; code de sortie non nul si une étape échoue. */

import { spawn } from "node:child_process";

const PARALLELE = ["typecheck", "lint", "test"];
const rapide = process.argv.includes("--rapide");

function lancer(script) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn("npm", ["run", "--silent", script], { shell: true, env: { ...process.env, FORCE_COLOR: "0" } });
    let sortie = "";
    p.stdout.on("data", (d) => { sortie += d; });
    p.stderr.on("data", (d) => { sortie += d; });
    p.on("close", (code) => resolve({ script, code, sortie, s: ((Date.now() - t0) / 1000).toFixed(1) }));
  });
}

function afficher({ script, code, sortie, s }) {
  console.log(`\n── ${script} : ${code === 0 ? "vert" : `ROUGE (code ${code})`} en ${s} s`);
  if (code !== 0 || process.env.CHECK_VERBEUX) process.stdout.write(sortie);
  else process.stdout.write(sortie.split("\n").filter((l) => /^ℹ (tests|pass|fail|skipped)|problem/.test(l)).map((l) => `   ${l}\n`).join(""));
}

const t0 = Date.now();
const resultats = await Promise.all(PARALLELE.map(lancer));
resultats.forEach(afficher);
let rouge = resultats.some((r) => r.code !== 0);

if (!rouge && !rapide) {
  const build = await lancer("build");
  afficher(build);
  rouge = build.code !== 0;
}

console.log(`\ncheck${rapide ? " rapide" : ""} : ${rouge ? "ROUGE" : "vert"} en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(rouge ? 1 : 0);
