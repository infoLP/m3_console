// Jetons du système de design (M3-106) : contrat entre styles/base.css, Tailwind
// (src/app/globals.css) et shared/model.js. Les CSS sont lues comme du texte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAT, STATUSES, catInfo } from "../shared/model.js";

const lire = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sansCommentaires = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const base = sansCommentaires(lire("styles/base.css"));
const globals = lire("src/app/globals.css");
const model = lire("shared/model.js");

/* Déclarations --x:valeur d'un bloc dont le sélecteur est exactement `selecteur`. */
function bloc(css, selecteur) {
  const i = css.indexOf(`\n${selecteur}{`);
  assert.notEqual(i, -1, `bloc ${selecteur} introuvable dans base.css`);
  const corps = css.slice(css.indexOf("{", i) + 1, css.indexOf("\n}", i));
  return Object.fromEntries([...corps.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const clair = bloc(base, ".cr");
const sombre = bloc(base, '[data-theme="dark"] .cr');

const CONTRAT = {
  "text-2xs": null, "text-xs": null, "text-sm": null, "text-base": null,
  "text-md": null, "text-lg": null, "text-xl": null, "text-2xl": null,
  "space-1": "4px", "space-2": "8px", "space-3": "12px", "space-4": "16px",
  "space-5": "20px", "space-6": "24px", "space-8": "32px",
  "r-xs": "4px", "r-sm": "6px", "r": "8px", "r-lg": "12px", "r-pill": "999px",
};

test("chaque jeton du contrat existe dans le bloc .cr, avec sa valeur", () => {
  for (const [nom, valeur] of Object.entries(CONTRAT)) {
    assert.ok(nom in clair, `--${nom} manquant`);
    if (valeur) assert.equal(clair[nom], valeur, `--${nom}`);
  }
});

test("l'échelle de texte est en px et strictement croissante", () => {
  const tailles = ["2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl"].map((k) => {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(clair[`text-${k}`]);
    assert.ok(m, `--text-${k} doit être en px`);
    return Number(m[1]);
  });
  for (let i = 1; i < tailles.length; i++) assert.ok(tailles[i] > tailles[i - 1], `échelle non croissante : ${tailles}`);
});

const HEX = /^#[0-9A-Fa-f]{6}$/;

test("chaque statut a son jeton clair ET sombre, et model.js n'en garde que le nom", () => {
  for (const [cle, s] of Object.entries(STATUSES)) {
    assert.equal(s.token, `status-${cle}`);
    assert.equal(s.color, `var(--status-${cle})`);
    assert.match(clair[s.token] || "", HEX, `--${s.token} clair`);
    assert.match(sombre[s.token] || "", HEX, `--${s.token} sombre`);
  }
});

test("chaque rubrique a sa couleur et sa teinte, en clair ET en sombre", () => {
  for (const [nom, r] of Object.entries(CAT)) {
    assert.match(r.token, /^rub-[a-z]+$/, nom);
    assert.equal(r.c, `var(--${r.token})`);
    assert.equal(r.tint, `var(--${r.token}-tint)`);
    for (const t of [r.token, `${r.token}-tint`]) {
      assert.match(clair[t] || "", HEX, `--${t} clair`);
      assert.match(sombre[t] || "", HEX, `--${t} sombre`);
    }
  }
  assert.equal(catInfo("Inconnue").c, "var(--brand)");
});

/* Contraste WCAG 2.x. */
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255]
    .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("en sombre, statuts et rubriques tiennent 4,5:1 sur --surface (et la rubrique sur sa teinte)", () => {
  const surface = sombre.surface;
  for (const s of Object.values(STATUSES)) {
    assert.ok(contraste(sombre[s.token], surface) >= 4.5, `--${s.token} : ${contraste(sombre[s.token], surface).toFixed(2)}`);
  }
  for (const r of Object.values(CAT)) {
    assert.ok(contraste(sombre[r.token], surface) >= 4.5, `--${r.token} sur --surface`);
    assert.ok(contraste(sombre[r.token], sombre[`${r.token}-tint`]) >= 4.5, `--${r.token} sur sa teinte`);
  }
});

test("globals.css : @theme inline, aucune couleur en dur, noms Tailwind conservés", () => {
  assert.match(globals, /@theme inline\b/);
  assert.doesNotMatch(globals, /@theme\s*\{/);
  assert.doesNotMatch(sansCommentaires(globals), /#[0-9A-Fa-f]{3,8}\b/);
  for (const nom of ["--color-brand", "--radius-m3", "--radius-m3-sm"]) assert.ok(globals.includes(`${nom}:`), nom);
  for (const s of Object.values(STATUSES)) assert.ok(globals.includes(`--color-${s.token}: var(--${s.token});`), s.token);
  for (const r of Object.values(CAT)) assert.ok(globals.includes(`--color-${r.token}-tint: var(--${r.token}-tint);`), r.token);
  // Pas de preflight dans ce lot (décision : écran par écran).
  assert.doesNotMatch(sansCommentaires(globals), /preflight/);
});

test("model.js : aucun hex dans STATUSES ni CAT", () => {
  for (const nom of ["STATUSES", "CAT"]) {
    const i = model.indexOf(`export const ${nom} = {`);
    const source = model.slice(i, model.indexOf("\n};", i));
    // Un champ `hex` réservé au serveur serait la seule exception admise.
    assert.doesNotMatch(source.replace(/\bhex:\s*"#[0-9A-Fa-f]{6}"/g, ""), /#[0-9A-Fa-f]{3,8}\b/, nom);
  }
  const valeurs = JSON.stringify([STATUSES, CAT, catInfo("?")], (k, v) => (k === "hex" ? undefined : v));
  assert.doesNotMatch(valeurs, /#[0-9A-Fa-f]{3,8}\b/);
});
