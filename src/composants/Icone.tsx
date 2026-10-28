// Icône SVG inline : les tracés sont dans shared/icons.js.

import type { CSSProperties } from "react";
import { P } from "@shared/icons.js";

const TRACES = P as Record<string, string>;

export function Icone({ nom, size = 16, sw = 2, className = "", style }: { nom: string; size?: number; sw?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw}
         strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true"
         dangerouslySetInnerHTML={{ __html: TRACES[nom] || "" }} />
  );
}
