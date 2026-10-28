import "server-only";
import { action } from "@/pont";
import * as api from "@/api/concurrents.js";
import type { Candidat, Concurrent, EtatScan, StatutCandidat } from "./gererConcurrents.regles";

export const lireConcurrents = action<{ competitors: Concurrent[] }>(api.list);
export const lireEtatScan = action<{ scan: EtatScan | null }>(api.scanStatus);
export const lireCandidats = action<{ status: StatutCandidat; candidates: Candidat[] }>(api.candidates);
