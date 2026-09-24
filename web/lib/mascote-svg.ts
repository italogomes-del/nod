import type { BotFrame } from "../vendor/bloub/engine.ts";
import { DEMI_VIEWBOX as V, RAYON } from "../vendor/bloub/repere.ts";
import { mixHex } from "../vendor/bloub/skins.ts";
import { esc } from "./escape.ts";

export function svgMascote(f: BotFrame, id: string, ink: string, paper = "#ffffff"): string {
  const dots = f.dots.map(d => {
    const fill = d.color ?? (d.depth === undefined ? ink : mixHex(paper, ink, d.depth));
    return d.d ? `<path d="${esc(d.d)}" fill="${fill}" opacity="${d.opacity}" transform="translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${RAYON})"/>`
      : `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${fill}" opacity="${d.opacity}"/>`;
  }).join("");
  const arcs = (side: "front" | "back") => f.arcs.map((a, i) => `<path d="${esc(a[side])}" fill="none" stroke="url(#${id}-a${i})" stroke-width="${a.width}" stroke-linecap="round" opacity="${a.opacity}"/>`).join("");
  return `<svg viewBox="-${V} -${V} ${2*V} ${2*V}" aria-hidden="true"><defs>
    <mask id="${id}" maskUnits="userSpaceOnUse" x="-${V}" y="-${V}" width="${2*V}" height="${2*V}"><path d="${esc(f.bodyPath)}" fill="white"/>
    ${f.eyes.map(e => `<path d="${esc(e.d)}" transform="${e.matrix}" fill="black" opacity="${e.alpha}"/>`).join("")}
    ${f.notch ? `<circle cx="${f.notch.x}" cy="${f.notch.y}" r="${f.notch.r}" fill="black"/>` : ""}</mask>
    ${f.arcs.map((a,i) => `<linearGradient id="${id}-a${i}" gradientUnits="userSpaceOnUse" x1="${a.grad.x1}" y1="${a.grad.y1}" x2="${a.grad.x2}" y2="${a.grad.y2}">${a.grad.stops.map((c,j) => `<stop offset="${j/(a.grad.stops.length-1)}" stop-color="${c}"/>`).join("")}</linearGradient>`).join("")}
    </defs>${arcs("back")}${f.dotsBehind ? dots : ""}
    <g opacity="${f.bodyAlpha}"><path d="${esc(f.bodyPath)}" fill="${paper}"/><g mask="url(#${id})"><rect x="-${V}" y="-${V}" width="${2*V}" height="${2*V}" fill="${ink}"/></g></g>
    ${f.dotsBehind ? "" : dots}${f.notif ? `<circle cx="${f.notif.x}" cy="${f.notif.y}" r="${f.notif.r}" fill="#2496e8" style="fill: var(--nod-aviso, #2496e8)"/>` : ""}${arcs("front")}</svg>`;
}
