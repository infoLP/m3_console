import "server-only";
import { action } from "@/pont";
import * as ops from "@/api/ops.js";
import type { Executions } from "./lancerExecutions.regles";

export const lireExecutions = action<Executions>(ops.lastRun);
