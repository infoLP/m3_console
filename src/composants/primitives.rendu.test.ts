// Rendus statiques (react-dom/server) : l'accessibilité des primitives se lit
// dans le HTML produit, sans navigateur. Pas de JSX ici (*.test.ts) : createElement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Bouton } from "./Bouton";
import { Champ } from "./Champ";
import { ConfirmationSurPlace } from "./ConfirmationSurPlace";
import { Etiquette, slugRubrique } from "./Etiquette";
import { Message } from "./Message";
import { Tiroir } from "./Tiroir";
import { Titre } from "./Titre";
import { Tuile } from "./Tuile";

const attr = (html: string, nom: string) => [...html.matchAll(new RegExp(`${nom}="([^"]*)"`, "g"))].map((m) => m[1]);

test("Champ : le libellé vise le contrôle, aide et erreur le décrivent, aria-invalid posé", () => {
  const html = renderToStaticMarkup(h(Champ, { libelle: "Nom", aide: "Tel qu'affiché", erreur: "Obligatoire", name: "nom" }));
  const [pour] = attr(html, "for");
  assert.match(html, new RegExp(`<input[^>]*id="${pour}"`));
  assert.match(html, /aria-invalid="true"/);
  const [decrit] = attr(html, "aria-describedby");
  const ids = decrit.split(" ");
  assert.equal(ids.length, 2);
  for (const id of ids) assert.match(html, new RegExp(`<p id="${id}"`));
  assert.match(html, /name="nom"/);
});

test("Champ sans erreur : ni aria-invalid ni référence à une erreur absente", () => {
  const html = renderToStaticMarkup(h(Champ, { libelle: "Nom" }));
  assert.doesNotMatch(html, /aria-invalid/);
  assert.doesNotMatch(html, /aria-describedby/);
});

test("Champ : l'enfant fourni reçoit l'id et garde son propre aria-describedby", () => {
  const html = renderToStaticMarkup(h(Champ, { libelle: "Rubrique", aide: "Une seule" },
    h("select", { "aria-describedby": "externe" }, h("option", null, "Sport"))));
  const [pour] = attr(html, "for");
  assert.match(html, new RegExp(`<select[^>]*id="${pour}"`));
  assert.match(attr(html, "aria-describedby")[0], /^externe \S+-aide$/);
  assert.match(html, /class="ui-champ-controle"/);
});

test("Message : erreur en alert, les autres en status", () => {
  assert.match(renderToStaticMarkup(h(Message, { ton: "erreur" }, "Échec")), /role="alert"/);
  for (const ton of ["info", "succes", "avertissement"] as const) {
    assert.match(renderToStaticMarkup(h(Message, { ton }, "x")), /role="status"/);
  }
});

test("Tiroir ouvert : dialogue modal nommé par son titre", () => {
  const html = renderToStaticMarkup(h(Tiroir, { ouvert: true, onFermer: () => {}, titre: "Détail de l'article" }, "Corps"));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  const [nomme] = attr(html, "aria-labelledby");
  assert.match(html, new RegExp(`<h2 id="${nomme}"[^>]*>Détail de l&#x27;article</h2>`));
  assert.match(html, /aria-label="Fermer"/);
  assert.match(html, /ui-tiroir--droite/);
});

test("Tiroir fermé : rien n'est rendu", () => {
  assert.equal(renderToStaticMarkup(h(Tiroir, { ouvert: false, onFermer: () => {}, titre: "x" })), "");
});

test("Bouton : type=button par défaut, chargement désactive et annonce", () => {
  assert.match(renderToStaticMarkup(h(Bouton, null, "OK")), /type="button"/);
  assert.match(renderToStaticMarkup(h(Bouton, { type: "submit" }, "OK")), /type="submit"/);
  const html = renderToStaticMarkup(h(Bouton, { chargement: true, variante: "primaire" }, "Envoi"));
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /ui-bouton--primaire/);
});

test("ConfirmationSurPlace au repos : un seul bouton déclencheur, rien d'autre", () => {
  const html = renderToStaticMarkup(h(ConfirmationSurPlace, { libelle: "Supprimer", consequence: "La source disparaît.", onConfirm: () => {} }));
  assert.match(html, /^<button[^>]*ui-bouton--danger[^>]*>Supprimer<\/button>$/);
});

test("Etiquette : statut avec libellé de STATUSES, rubrique sur ses jetons", () => {
  assert.match(renderToStaticMarkup(h(Etiquette, { statut: "a_revoir" })), /ui-etiquette--statut-a_revoir[^>]*>À revoir</);
  const rub = renderToStaticMarkup(h(Etiquette, { rubrique: "Économie" }));
  assert.match(rub, /var\(--rub-economie, var\(--brand\)\)/);
  assert.match(rub, />Économie</);
  assert.equal(slugRubrique("Société"), "societe");
});

test("Titre : balise du niveau, `as` la remplace sans changer le style", () => {
  assert.match(renderToStaticMarkup(h(Titre, { niveau: 1, children: "A" })), /^<h1 class="ui-titre ui-titre--n1">A<\/h1>$/);
  assert.match(renderToStaticMarkup(h(Titre, { niveau: 2, as: "h3", children: "B" })), /^<h3 class="ui-titre ui-titre--n2">/);
  assert.match(renderToStaticMarkup(h(Titre, { niveau: 2, kicker: "K", children: "C" })), /^<hgroup/);
});

test("Tuile avec onClick et sans href : un <button type=button>, classes du lien (R12)", () => {
  const html = renderToStaticMarkup(h(Tuile, { libelle: "À revoir", valeur: 4, ton: "amber", onClick: () => {} }));
  assert.match(html, /^<button type="button" class="ui-tuile ui-tuile--amber ui-tuile--lien ui-tuile--bouton"/);
});

test("Tuile sans href ni onClick : un simple bloc, pas un contrôle", () => {
  const html = renderToStaticMarkup(h(Tuile, { libelle: "Publiés", valeur: 12 }));
  assert.match(html, /^<div class="ui-tuile ui-tuile--neutre"/);
  assert.doesNotMatch(html, /<button|<a /);
});

test("ConfirmationSurPlace : id, aria-label et title passent au déclencheur (R13)", () => {
  const html = renderToStaticMarkup(h(ConfirmationSurPlace, { libelle: "Classer", consequence: "x", onConfirm: () => {}, id: "btn-classer", ariaLabel: "Classer l'article", title: "Raccourci : C" }));
  assert.match(html, /<button[^>]*id="btn-classer"/);
  assert.match(html, /<button[^>]*aria-label="Classer l&#x27;article"/);
  assert.match(html, /<button[^>]*title="Raccourci : C"/);
});
