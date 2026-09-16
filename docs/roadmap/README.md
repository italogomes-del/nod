# Roadmap do nod — jornadas

Este diretório descreve **para onde o nod vai**, em forma de **jornadas**: cada arquivo `.md` é uma
jornada do usuário (uma narrativa de alguém realizando algo de ponta a ponta), com as capacidades
que ela introduz, o impacto arquitetural e os critérios de aceite.

Difere de [docs/adr/](../adr/): o ADR registra uma **decisão** já tomada (com gatilho de reversão);
a jornada registra uma **intenção de produto** ainda por construir. Quando uma jornada é construída,
ela vira commits + testes + ADRs; o arquivo de jornada permanece como o "porquê" narrativo.

## Norte desta rodada (definido em 2026-09-16)

> **O nod deve se tornar equivalente ao OpenMausBot, EXCETO a feature de Companion**
> (pareamento desktop-a-desktop via Tailscale).

Isto é uma **inversão deliberada** de várias decisões da fundação. Os ADRs que sustentam o nod atual
recusaram, com justificativa e gatilho, exatamente as features que este roadmap agora quer trazer —
sobretudo **ADR-028** (nenhum turno roda fora da máquina do proxy) e **ADR-013** (o proxy contém o
agente). Cada jornada abaixo nomeia os ADRs que reverte e por qual gatilho. Isto não é descuido: é a
forma correta de reabrir uma decisão neste repositório — pela porta da frente, com o gatilho na mão.

**A garantia que NÃO abrimos mão** (a linha vermelha do norte): o bot sempre precisa conseguir
**escalar para a pessoa** (`pedir_a_pessoa`, `pedir_aprovação`). No OMB, o agente no desktop da nuvem
não consegue nem perguntar (`server/drivers/boxagent.ts:294` → `"unavailable"`). Toda jornada que
mover "as mãos" do bot para longe deve seguir o **modelo VPS** (cérebro + proxy locais, só as mãos
remotas — `server/vps-computer.ts`), nunca o modelo em que o turno inteiro emigra.

## Convenção dos arquivos

- Nome: `jornada-NN-<slug-em-kebab>.md`.
- Cada jornada tem: **Norte / valor**, **Persona & pré-condições**, **A jornada passo a passo**
  (perspectiva do usuário), **Capacidades introduzidas** (de → para, mapeadas ao OMB), **Fora de
  escopo**, **Impacto arquitetural & ADRs afetados** (com gatilho), **Critérios de aceite**,
  **Perguntas em aberto**.

## Índice

| # | Jornada | Cobre (features do OMB) | Estado |
|---|---|---|---|
| [01](jornada-01/office-hours.md) | O bot ganha mãos — controle de computador e capacidades de operador ([épicos](jornada-01/epicos.md), [issues](jornada-01/issues.md)) | Ponto 1 (desktop na nuvem, controle da máquina local) + Ponto 2 (shell, arquivo, desktop, browser, conectores estilo Composio, permission broker) | **rascunho — detalhada** |
| [02](jornada-02-bots-se-chamam.md) | Bots se chamam — delegação, @menção e workflows entre bots ([épicos](jornada-02-epicos.md)) | Multi-bot interativo (referência: Grok Bot; o OMB só tem channels). **nod já tem o motor; falta a experiência.** | **rascunho — detalhada** |

> As evidências que motivam as jornadas ficam em [evidencias/](evidencias/README.md).

### Pré-esboços de ADR (viram ADR definitivo quando a jornada for construída)

| Pré-ADR | Assunto | Refina/reverte | Jornada |
|---|---|---|---|
| [Pré-ADR-030](pre-adr-030-maos-remotas-modelo-vps.md) | Mãos remotas seguem o modelo VPS (cérebro local, mãos remotas) | refina ADR-028 | 01 |

### Backlog de jornadas (candidatas, ainda não escritas)

Derivadas das features do OMB fora dos Pontos 1 e 2. Marcadas para virar arquivo próprio quando
priorizadas:

| # | Jornada candidata | Cobre |
|---|---|---|
| 03 | Vários provedores no mesmo SPI | drivers Codex e Grok além do Claude |
| 04 | Voz | text-to-speech e chamadas de voz |
| 05 | Distribuição desktop | apps Electron (macOS/Windows/Linux) + updater |
| 06 | Modo `serve` / self-host | `npx openmausbot serve`, VPS, stack Docker |

> **Companion (pareamento desktop-a-desktop via Tailscale): fora do roadmap, por decisão do dono
> (2026-09-16).** É a única feature do OMB que o nod NÃO persegue.
