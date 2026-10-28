import "server-only";
import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import type { Notification } from "./suivreNotifications.regles";

export const lireNotifications = action<{ notifications: Notification[]; unread: number }>(meta.notifications);
