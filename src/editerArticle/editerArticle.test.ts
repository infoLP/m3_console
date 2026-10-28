import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { choisir, editerChamp, editerTexte, fusionnerPatch, structure } from "./editerArticle.regles";
import type { Article } from "@/relireArticles/relireArticles.regles";

const A = (): Article => ({
  id: "a", title: "Titre", chapo: "Chapô", body: [{ id: "b1", type: "p", text: "Un." }, { id: "b2", type: "h2", text: "Inter" }],
  cat: "Économie", ranking: 50, status: "a_revoir", zone: { num: "17", region: "NA" }, source: { type: "site", label: "S", url: "https://s" },
  illustration: null, seo: { metaTitle: "mt", metaDescription: "md", slug: "slug", keywords: ["a"] },
});

describe("édition du texte", () => {
  it("un bloc modifié par identifiant, l'original intact", () => {
    const a = A();
    const m = editerTexte(a, "block:b2", "Nouveau")!;
    assert.equal((m.article.body as { text: string }[])[1].text, "Nouveau");
    assert.equal((a.body as { text: string }[])[1].text, "Inter");
    assert.equal((m.patch.body as { id: string }[]).length, 2);
  });
  it("le plan édite le corps : ol:<id> = block:<id>, ol:title = titre", () => {
    assert.equal((editerChamp(A(), "ol:b2", "X")!.article.body as { text: string }[])[1].text, "X");
    assert.equal(editerChamp(A(), "ol:title", "T2")!.patch.title, "T2");
  });
});

describe("champs de la colonne de droite", () => {
  it("slug normalisé, ranking borné, numéro de département en chiffres", () => {
    const s = editerChamp(A(), "slug", "Mon Slug  Ici")!;
    assert.equal(s.valeurAffichee, "mon-slug-ici");
    assert.equal(editerChamp(A(), "rank", "140")!.article.ranking, 100);
    assert.equal(editerChamp(A(), "rank", "abc")!.article.ranking, 0);
    const n = editerChamp(A(), "num", "1a7b9")!;
    assert.equal(n.valeurAffichee, "179");
    assert.equal(n.article.zone.num, "179");
  });
  it("une illustration naît du premier champ saisi", () => {
    const m = editerChamp(A(), "illourl", "https://img")!;
    assert.deepEqual(m.article.illustration, { credit: "", url: "https://img" });
    assert.deepEqual(m.patch, { illustration: { url: "https://img" } });
  });
  it("source : type choisi crée la source si elle manque", () => {
    const a = { ...A(), source: null };
    assert.deepEqual(choisir(a, "srctype", "pdf")!.article.source, { type: "pdf", label: "", url: "" });
  });
});

describe("structure", () => {
  it("supprimer le dernier bloc en laisse un vide", () => {
    const a = { ...A(), body: [{ id: "b1", type: "p", text: "x" }] };
    const m = structure.blockDel(a, "b1")!;
    assert.equal((m.article.body as unknown[]).length, 1);
    assert.equal((m.article.body as { text: string }[])[0].text, "");
  });
  it("mots-clés : minuscules, sans doublon", () => {
    assert.equal(structure.kwAdd(A(), " A "), null);
    assert.deepEqual(structure.kwAdd(A(), "Rochefort")!.article.seo.keywords, ["a", "rochefort"]);
    assert.deepEqual(structure.kwRemove(A(), "a").article.seo.keywords, []);
  });
  it("changer le type d'un bloc, sans effet si identique", () => {
    assert.equal(structure.blockType(A(), "b2", "h2"), null);
    assert.equal((structure.blockType(A(), "b2", "h3")!.article.body as { type: string }[])[1].type, "h3");
  });
});

describe("fusionnerPatch", () => {
  it("fusionne les objets imbriqués au lieu de les écraser", () => {
    const p = fusionnerPatch({ seo: { metaTitle: "a" }, title: "t" }, { seo: { slug: "s" }, chapo: "c" });
    assert.deepEqual(p, { seo: { metaTitle: "a", slug: "s" }, title: "t", chapo: "c" });
    assert.deepEqual(fusionnerPatch({ illustration: { url: "x" } }, { illustration: null }), { illustration: null });
  });
});
