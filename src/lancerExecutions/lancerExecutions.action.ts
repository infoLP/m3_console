"use server";

import { action } from "@/pont";
import * as ops from "@/api/ops.js";
import * as articles from "@/api/articles.js";
import { tenter } from "@/resultat";
import type { Demande } from "./lancerExecutions.regles";

const recolte = action<{ ok: boolean; job: Demande }>(ops.harvest);
const generation = action<{ ok: boolean; job: Demande }>(articles.runGenerate);
const rescore = action<{ changed: number; total: number }>(articles.rescoreArticles);
const purge = action<{ ok: boolean; removed: number; rearmed: boolean; allowRegen: boolean }>(articles.purgeArticles);

export async function demanderRecolte() { return tenter(recolte({ body: {} })); }
export async function demanderGeneration() { return tenter(generation({ body: {} })); }
export async function recalculerScores() { return tenter(rescore({ body: {} })); }
/* T14 : allowRegen (case « autoriser la régénération ») reste à false par défaut. */
export async function purgerArticles(allowRegen = false) { return tenter(purge({ body: { allowRegen: allowRegen === true } })); }
