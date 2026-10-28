import { test } from "node:test";
import assert from "node:assert/strict";
import { cibleTab } from "./piegeFocus";

test("Tab sur le dernier élément revient au premier", () => {
  assert.equal(cibleTab(3, 2, false), 0);
});

test("Maj+Tab sur le premier élément part au dernier", () => {
  assert.equal(cibleTab(3, 0, true), 2);
});

test("au milieu de la modale, le navigateur garde la main", () => {
  assert.equal(cibleTab(3, 1, false), null);
  assert.equal(cibleTab(3, 1, true), null);
});

test("un focus hors de la modale y revient, au bord qui suit le sens", () => {
  assert.equal(cibleTab(3, -1, false), 0);
  assert.equal(cibleTab(3, -1, true), 2);
});

test("un seul élément : le focus y reste dans les deux sens", () => {
  assert.equal(cibleTab(1, 0, false), 0);
  assert.equal(cibleTab(1, 0, true), 0);
});

test("rien de focalisable : rien à faire", () => {
  assert.equal(cibleTab(0, -1, false), null);
});
