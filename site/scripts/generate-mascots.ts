import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { BotEngine } from "../../web/vendor/bloub/engine.ts";
import { RAYON } from "../../web/vendor/bloub/repere.ts";
import { SHAPE_BY_ID, type ShapeId } from "../../web/vendor/bloub/skins.ts";
import { REPOUSO_NOD } from "../../web/lib/mascote-pose.ts";
import { svgMascote } from "../../web/lib/mascote-svg.ts";

const mascots: { name: string; shape: ShapeId; color: string }[] = [
  { name: "vera", shape: "squircle", color: "#4c75ee" },
  { name: "lume", shape: "capsule", color: "#ef9454" },
  { name: "nico", shape: "hexagone", color: "#609480" },
  { name: "bia", shape: "nuage", color: "#9a85c9" },
];
const output = new URL("../public/mascots/", import.meta.url);
const halfSize = 112;

await mkdir(output, { recursive: true });

for (const mascot of mascots) {
  const shape = SHAPE_BY_ID.get(mascot.shape);
  if (!shape) throw new Error(`Forma ausente: ${mascot.shape}`);
  const engine = new BotEngine(RAYON, "idle", shape.radii, REPOUSO_NOD);
  const frame = engine.sample(0.6, false);
  const coordinates = frame.bodyPath.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (coordinates.some(coordinate => Math.abs(coordinate) >= halfSize - 4)) {
    throw new Error(`Margem insuficiente: ${mascot.name}`);
  }
  const svg = svgMascote(frame, `nod-${mascot.name}`, mascot.color, "#ffffff")
    .replace(/^<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="224" height="224" viewBox="-${halfSize} -${halfSize} 224 224" aria-hidden="true"><metadata>Generated from Nod's Bloub renderer. Bloub: Copyright (c) 2026 Jérémy Perret. MIT License; see LICENSE.txt.</metadata>`);
  await writeFile(new URL(`${mascot.name}.svg`, output), `${svg}\n`);
}

await copyFile(new URL("../../web/vendor/bloub/LICENSE", import.meta.url), new URL("LICENSE.txt", output));
