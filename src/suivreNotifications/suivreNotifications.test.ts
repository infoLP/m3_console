import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { libelle, lienNotification, type Notification } from "./suivreNotifications.regles";

const N = (p: Partial<Notification>): Notification => ({ id: "n1", type: "source_inaccessible", at: "2026-10-27T09:00:00Z", read: false, ...p });

describe("lien d'une notification (M3-122)", () => {
  it("nouveaux domaines candidats → « voir les candidats » vers Sources → Concurrents, dans l'appli", () => {
    const n = N({ type: "competitors_candidates", detail: "3 nouveaux domaines" });
    assert.equal(libelle(n), "Nouveaux domaines candidats");
    assert.deepEqual(lienNotification(n), { href: "/admin/concurrents", libelle: "voir les candidats", externe: false });
  });

  it("les autres : la source si n.url est en http(s), sinon rien", () => {
    assert.deepEqual(lienNotification(N({ url: "https://www.gironde.fr/actu" })), { href: "https://www.gironde.fr/actu", libelle: "voir la source", externe: true });
    assert.equal(lienNotification(N({ url: "javascript:alert(1)" })), null);
    assert.equal(lienNotification(N({})), null);
  });
});
