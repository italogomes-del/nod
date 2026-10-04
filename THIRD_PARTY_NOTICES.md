# Third-party notices

## Temporary bot mascot

The temporary SVG mascot vendors the framework-independent engine from
[`jeremy-prt/bloub`](https://github.com/jeremy-prt/bloub), Copyright (c) 2026 Jérémy Perret,
made available under the MIT License. Bloub recreates the visual behaviour of the x.ai bot avatar;
Grok and x.ai belong to their respective owners. The mascot in nod is intentionally isolated so it
can be replaced by nod's own identity.

Source revision: b4bb3c1b5f93c7b87a2e8d620f667c4093d97749.
Sources and full MIT license: web/vendor/bloub/.
Local adaptations: explicit .ts import extensions; optional animateRest parameter in
BotEngine.sample (default unchanged) to disable wandering/blinking/breathing for nod's fixed idle pose.
The neutral expression is calibrated in web/lib/mascote-pose.ts to the supplied static reference.
The SVG renderer and DOM lifecycle adapter live in web/lib/mascote-svg.ts and
web/lib/mascote-elemento.ts. No Vue runtime is included.

## Geist and Geist Mono fonts

The web interface serves the Geist and Geist Mono variable fonts (latin and latin-ext subsets,
`web/public/fontes/`), Copyright 2024 The Geist Project Authors
(https://github.com/vercel/geist-font), licensed under the SIL Open Font License 1.1. Files taken from
the `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` packages, version 5.3.0.
Full license: web/public/fontes/OFL-geist.txt.
