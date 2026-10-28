// M3-72 : « Envoyer en parution » exige les cinq critères, et le contrôle vit
// côté serveur — un appel direct à l'action, bouton contourné, est refusé.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFORMITE_REFUS, controlerParution, criteresManquants, refusConformite, STATUTS_PARUTION, type Article } from "./relireArticles.regles";

const corps = (n: number) => [{ id: "b0", type: "h2", text: "Intertitre" }, { id: "b1", type: "p", text: "x".repeat(n) }];

/* Un article qui remplit les cinq critères avec les réglages par défaut. */
const conforme = (): Article => ({
  id: "art-1",
  title: "Un titre",
  chapo: "Chapô",
  body: corps(1600),
  cat: "Économie",
  ranking: 80,
  status: "a_revoir",
  zone: { num: "17" },
  source: { type: "site", label: "Mairie", url: "https://example.org/a" },
  illustration: { url: "https://example.org/a.jpg", credit: "© M3" },
  seo: { metaTitle: "Un titre", metaDescription: "d".repeat(100), slug: "titre-article", keywords: ["a", "b", "c"] },
});

const deps = (a: Article, sansIllustration = false, settings: Record<string, unknown> | null = null) => ({
  lireArticle: async (id: string) => { assert.equal(id, a.id); return a; },
  contexte: async () => ({ settings, sansIllustration }),
});

describe("M3-72 : critères de parution", () => {
  it("un article à 5/5 passe", async () => {
    assert.deepEqual(criteresManquants(conforme()), []);
    assert.equal(await controlerParution("art-1", deps(conforme())), null);
  });

  it("un article à 4/5 est refusé, le critère manquant nommé", async () => {
    const a = { ...conforme(), ranking: 40 };
    const refus = await controlerParution("art-1", deps(a));
    assert.ok(refus && refus.startsWith(CONFORMITE_REFUS));
    assert.match(refus!, /Manque : Alignement éditorial\.$/);
  });

  it("plusieurs critères manquants, dans l'ordre du cahier des charges", () => {
    const a = { ...conforme(), body: corps(200), source: { type: "none" }, seo: { ...conforme().seo, slug: "Pas Un Slug" } };
    assert.deepEqual(criteresManquants(a), ["Longueur", "Source citée", "SEO complet"]);
    assert.equal(refusConformite(criteresManquants(a)), `${CONFORMITE_REFUS} Manque : Longueur, Source citée, SEO complet.`);
  });

  it("l'illustration suit la FEAT « Parution sans illustration » (M3-93)", async () => {
    const sansImage = { ...conforme(), illustration: null };
    assert.match((await controlerParution("art-1", deps(sansImage, false)))!, /Manque : Illustration\./, "FEAT fermée au rôle : bloqué");
    assert.equal(await controlerParution("art-1", deps(sansImage, true)), null, "FEAT ouverte : l'image n'est pas exigée");
    const caseVide = { ...conforme(), illustration: { url: "  ", credit: "" } };
    assert.deepEqual(criteresManquants(caseVide), ["Illustration"], "une case sans URL ne compte pas");
  });

  it("les réglages du serveur s'appliquent (seuil de ranking)", async () => {
    assert.match((await controlerParution("art-1", deps(conforme(), false, { ranking_threshold: 90 })))!, /Alignement éditorial/);
  });

  it("une parution programmée passe par le même contrôle, comme le passage en « valide » / « publie »", () => {
    assert.ok(STATUTS_PARUTION.has("valide"));
    assert.ok(STATUTS_PARUTION.has("publie"));
    assert.ok(!STATUTS_PARUTION.has("archive"), "classer sans diffusion reste toujours possible");
    assert.ok(!STATUTS_PARUTION.has("a_revoir"));
  });
});
