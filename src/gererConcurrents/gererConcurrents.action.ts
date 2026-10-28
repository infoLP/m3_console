"use server";

import { action } from "@/pont";
import * as api from "@/api/concurrents.js";
import { tenter } from "@/resultat";
import type { Candidat, Concurrent, EtatScan, Saisie, StatutCandidat } from "./gererConcurrents.regles";

/* 403 hors administrateur et superutilisateur, 400 saisie refusée, 409 doublon :
   l'erreur remonte telle quelle. */
const lister = action<{ competitors: Concurrent[] }>(api.list);
const creer = action<{ ok: boolean; competitor: Concurrent }>(api.create);
const modifier = action<{ ok: boolean; competitor: Concurrent }>(api.update);
const activer = action<{ ok: boolean; competitor: Concurrent }>(api.activate);
const retirer = action<{ ok: boolean; id: number; label: string }>(api.remove);

export async function relireConcurrents() {
  return tenter(lister({}));
}

export async function ajouterConcurrent(saisie: Saisie) {
  return tenter(creer({ body: saisie }));
}

export async function modifierConcurrent(id: number, saisie: Saisie) {
  return tenter(modifier({ params: [String(id)], body: saisie }));
}

export async function activerConcurrent(id: number, active: boolean) {
  return tenter(activer({ params: [String(id)], body: { active } }));
}

export async function retirerConcurrent(id: number) {
  return tenter(retirer({ params: [String(id)] }));
}

/* ---------- Scan et domaines candidats (M3-122) ---------- */

/* 409 si un scan tourne déjà, 503 tant que le moteur n'est pas livré. */
const etatScan = action<{ scan: EtatScan | null }>(api.scanStatus);
const lancer = action<{ ok: boolean; started: boolean }>(api.launchScan);
const candidats = action<{ status: StatutCandidat; candidates: Candidat[] }>(api.candidates);
const ecarter = action<{ ok: boolean; candidate: Candidat }>(api.discard);
const proposer = action<{ ok: boolean; candidate: Candidat }>(api.propose);
const adopter = action<{ ok: boolean; candidate: Candidat }>(api.adopt);

export async function relireEtatScan() {
  return tenter(etatScan({}));
}

export async function lancerScan() {
  return tenter(lancer({}));
}

export async function lireCandidats(status: StatutCandidat) {
  return tenter(candidats({ query: { status } }));
}

export async function ecarterCandidat(id: number) {
  return tenter(ecarter({ params: [String(id)] }));
}

export async function proposerCandidat(id: number) {
  return tenter(proposer({ params: [String(id)] }));
}

/* Appelé par Sources après l'enregistrement d'une source ouverte depuis un candidat. */
export async function marquerCandidatAjoute(id: number) {
  return tenter(adopter({ params: [String(id)] }));
}
