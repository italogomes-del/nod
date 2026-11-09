# O que sai do repo público e para onde vai (ADA-282)

A fonte é o `oss/manifesto.json`; esta tabela explica o porquê. Tudo o que sai **fica no `gamefik/nod` (privado)**.
Este arquivo não vai para o público.

| Sai | Para onde | Por quê |
|---|---|---|
| `fechado/**` | gamefik/nod (pasta fechada) | marketplace pago, pagamentos e recursos de empresa (`LICENSING.md`) |
| `infra/gcp/**`, `.github/workflows/{deploy,ensaio-restauracao,release-pendente,desktop-release}.yml` | gamefik/nod | operação da versão hospedada (projeto GCP, WIF, VM, release assinado) |
| `docs/deploy-gcp.md`, `docs/runbook-producao.md`, `docs/release-desktop.md`, `docs/processo-de-release.md` | gamefik/nod (docs internas) | mapeiam a produção |
| `docs/auditoria-2026-10-15/**`, `docs/uat-*`, `docs/planos/**`, `docs/plano-*`, `docs/comparacao-*`, `docs/grokbot-comparison.md`, `docs/internal-first.md`, `docs/prototipos/**`, `docs/design/**`, `docs/roadmap/**`, `docs/referencias/ditado-grok/**` | gamefik/nod (docs internas) | dado de pessoas e clientes, planejamento interno, capturas de terceiros |
| `docs/open-source/**`, `oss/**`, `scripts/oss/**`, `tests/unit/scripts/oss-exportar.test.ts` | gamefik/nod | a própria ferramenta de export cita os dados que esconde |
| `scripts/{diario-prod.mjs,dogfood-quadro.sql,backup-local.sh,limpar-esperas-nod-377.ts,recalcular-custo-bifurcado.ts}`, `scripts/cloud/**`, `scripts/desktop/{publicar-atualizacao.sh,release-mac.sh,release-pendente.mjs}` | gamefik/nod | operam a produção ou o release assinado |
| testes que leem arquivo excluído: `tests/unit/infra/**`, `tests/unit/scripts/{ensaiar-restauracao,app-windows-release,instalador-exe-windows}.test.ts`, `tests/unit/desktop/{atualizacao-release,publicar-atualizacao.regression-1,release-mac,release-pendente}.test.ts` (e os 4 `it` que leem o `desktop-release.yml` pulam quando ele não existe), `tests/integration/recalcular-custo-bifurcado.test.ts` | gamefik/nod | sem o arquivo que leem, falhariam no público |
| `.cursor/**`, `prototypes/**` | gamefik/nod | ambiente e protótipos internos |

**Desvio do plano publicado:** `infra/vm-local/**`, `scripts/vm-local/**`, `scripts/uat/**`, as sondas de voz e
`.claude/skills/**` **ficam públicos**. São produto (a VM local do app desktop) ou ferramenta de quem contribui, sem
dado de produção; excluí-los quebrava o typecheck e os testes do snapshot. Os nomes de bots internos neles são
reescritos.

**Reescritas** (nos arquivos que ficam): e-mails reais → `@exemplo.com`; `gamefik.com` → `exemplo.com`;
`nod-producao` → `nod-exemplos`; `nod-vm@` → `app-vm@`; IP da produção → `203-0-113-100` (faixa de documentação);
clientes e pessoas reais → nomes neutros; Xumbrega, Tarsila e EngNod → Faustino, Teodora e EngApp. Todas com o mesmo
tamanho, para os testes que medem texto.

**Fica público:** `src`, `web`, `desktop`, `motor`, `infra/computador`, `infra/postgres`, `infra/vm-local`, `tests`
(menos os da tabela), `docs/adr`, `docs/arquitetura.md`, os demais docs de produto, `docker-compose*.yml`, `ci.yml` e
`site`.

**Follow-up para a CI pública** (fora deste PR): o `ci.yml` exportado usa runners do Blacksmith da organização e o job
`navegador` lê `infra/gcp/runner/libs-chromium.txt`, que não vai. Antes do primeiro push, o público precisa de um
`ci.yml` próprio (runners hospedados, sem self-hosted em PR de fork).
