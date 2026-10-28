import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etatDemande, estFinie, delaiSondage, LIBELLE_ETAT, texteAttente, messageEchec } from "./suivreDemande.regles";
import { attenteDe } from "./suivreDemande.api.js";

describe("suivre une demande", () => {
  it("état : attente, en cours, terminée, échec", () => {
    assert.equal(etatDemande({ startedAt: null, finishedAt: null, error: null }), "attente");
    assert.equal(etatDemande({ startedAt: "t", finishedAt: null, error: null }), "cours");
    assert.equal(etatDemande({ startedAt: "t", finishedAt: "t", error: null }), "finie");
    assert.equal(etatDemande({ startedAt: "t", finishedAt: "t", error: "non implémentée" }), "echec");
    assert.equal(LIBELLE_ETAT.attente, "En attente du moteur");
  });
  it("finie seulement avec une date de fin", () => {
    assert.equal(estFinie(null), false);
    assert.equal(estFinie({ finishedAt: null }), false);
    assert.equal(estFinie({ finishedAt: "2026-10-28T10:00:00Z" }), true);
  });
  it("sondage : 1 s au début, puis 2 s, puis 5 s", () => {
    assert.equal(delaiSondage(0), 1000);
    assert.equal(delaiSondage(10), 2000);
    assert.equal(delaiSondage(40), 5000);
  });
  // T19c : une régénération attend la génération en cours, l'écran le dit.
  it("attente : ce qui occupe la voie, ou le moteur arrêté", () => {
    const base = { id: 9, startedAt: null, finishedAt: null };
    assert.equal(texteAttente({ ...base, attente: { vivant: true, voie: "chaine", enCours: { id: 4, kind: "generate", depuis: null } } }),
      "En attente : le moteur termine une génération (n° 4), la vôtre partira ensuite.");
    assert.match(texteAttente({ ...base, attente: { vivant: false, voie: "chaine", enCours: null } }) || "", /ne répond pas/);
    assert.equal(texteAttente({ ...base, attente: { vivant: true, voie: "chaine", enCours: null } }), null);
    assert.equal(texteAttente({ ...base, startedAt: "t", attente: null }), null);
  });
  it("échec « bail tenu » : une routine est en cours, dit en clair", () => {
    const m = messageEchec({ kind: "regenerate", error: "Une exécution est déjà en cours (chaîne planifiée, depuis 06:30) — réessayez quand elle sera terminée." });
    assert.match(m || "", /^La régénération n'a pas été lancée : une routine/);
    assert.equal(messageEchec({ kind: "publish", error: "WordPress 500" }), "WordPress 500");
    assert.equal(messageEchec({ kind: "publish", error: null }), null);
  });
  it("attenteDe : lit la voie de la demande dans moteur/etat, sans se citer elle-même", async () => {
    const etat = { vivant: true, voies: { chaine: { occupee: true, demande: { id: 4, kind: "generate", depuis: "t" } }, articles: { occupee: false, demande: null } } };
    const lire = async () => etat;
    assert.deepEqual(await attenteDe({ id: 9, kind: "regenerate", startedAt: null, finishedAt: null }, lire),
      { vivant: true, voie: "chaine", enCours: { id: 4, kind: "generate", depuis: "t" } });
    assert.deepEqual(await attenteDe({ id: 10, kind: "publish", startedAt: null, finishedAt: null }, lire), { vivant: true, voie: "articles", enCours: null });
    assert.equal(await attenteDe({ id: 4, kind: "generate", startedAt: "t", finishedAt: null }, lire), null);
  });
});
