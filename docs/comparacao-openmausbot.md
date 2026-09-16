# nod × OpenMausBot — diferenças estruturais

Comparação entre a arquitetura do nod (verificada no código desta branch em 2026-09-16) e a do
[OpenMausBot](https://github.com/milind-soni/OpenMausBot) (verificada no repositório real +
dissecada pelos ADRs do nod). Contexto e analogias para leigos em [glossario.md](glossario.md); o
desenho formal do nod em [arquitetura.md](arquitetura.md); a intenção de aproximar o nod do OMB em
[roadmap/](roadmap/).

> **Nota de leitura.** Os ADRs do nod são "parte interessada": descrevem o OMB para justificar as
> escolhas do nod. Os fatos batem com o repositório real do OMB, mas o enquadramento é do nod — o OMB
> fez escolhas **diferentes para objetivos diferentes** (uma plataforma de bots que agem no mundo),
> não escolhas erradas. E, como já registrado, muito do nod ainda não está implementado; onde a
> diferença depende disso, está anotado.

## A diferença de fundo

O **OpenMausBot** é uma **plataforma** genérica que *faz coisas*: bots como contatos num app de chat,
que executam tarefas, controlam computadores e integram apps. O **nod** é uma **camada de
governança** estreita: o ponto central é a **decisão humana** com trilha de auditoria. O OMB otimiza
para **capacidade e alcance**; o nod, para **contenção e prova**.

## As sete diferenças estruturais

### 1. Direção da conexão — a maior de todas

- **OMB:** tem o subsistema `companion/` (pareamento máquina-a-máquina via Tailscale) e *computer
  control* (o agente dirige um desktop na nuvem ou a sua máquina local). Ou seja, existe todo um
  mecanismo para algo **de fora alcançar a máquina**.
- **nod:** a sua máquina **sempre liga para o servidor; o servidor nunca liga para você** (ADR-021).
  Sem túnel, sem relay, sem pareamento. Presença é o próprio poll. O nod deliberadamente **não
  constrói** o companion — a decisão diz, com todas as letras, que isso evita "um processo que mente
  sobre a própria origem, mais pareamento, mais token por dispositivo".

### 2. O que o agente pode fazer (raio de dano)

- **OMB:** amplo — mouse/teclado, shell, edição de arquivo, desktop na nuvem.
- **nod:** **nenhum** controle de computador, browser, ou "um computador por bot" (ADR-028,
  explicitamente fora). A superfície do agente é só as **9 ferramentas do nod** + conectores MCP
  registrados, e **tudo passa pelo porteiro (proxy)** contra o plano.

### 3. Autoridade da decisão — parecidos na forma, diferentes no primitivo

- **Ambos:** a autoridade é **local (loopback)**, não remota. Aliás, o nod **rejeitou** mover a
  autoridade para um endpoint síncrono no servidor — e a justificativa foi que a proposta citava mal
  o OMB (o `control-client` do OMB consulta um endpoint de **loopback**, e o estado do
  computer-control é "per-boot, in-memory ON PURPOSE").
- **A diferença:** o nod acrescenta o **plano de turno** (ADR-024) — o servidor emite, antes de cada
  turno, um envelope lacrado com o catálogo de ferramentas **já resolvido**, autoria, token e prazo;
  o proxy consome **só** isso. Resultado: **fail-closed é estrutural** — sem plano, não há catálogo,
  nada é liberado. No OMB a montagem por turno lê a config **local**; o nod move essa resolução para
  o **servidor**. É a contribuição que o próprio ADR reivindica como nova (nem o OMB nem o
  hermes-agent tinham).

### 4. Persistência e auditoria

- **OMB:** logs NDJSON por thread; estado do computer-control em memória por boot. A trilha **é** o
  log.
- **nod:** Postgres com **RLS em duas camadas** (empresa + pessoa, `FORCE`, escopo por transação);
  **trilha imutável por trigger** (não dá pra editar nem apagar); `events` particionada; outbox
  transacional; **autoria composta** (quem escreveu **e** em nome de quem). É auditoria de grau
  "cartório", não "arquivo de log".

### 5. Credenciais e segredos

- **OMB:** chaves de API em **texto puro** no `config.json` local, sem cifra.
- **nod:** env dos conectores **cifrado** no servidor; o CLI resolve a própria credencial e o nod
  **nunca a vê**; e há uma **denylist** que impede a chave da empresa "pegar carona" no ambiente e
  virar a assinatura pessoal em cobrança pay-as-you-go (ADR-015). Dois regimes opostos e explícitos.

### 6. Executor / provedores

- **OMB:** drivers **multi-provedor** (Claude, Codex, Grok, computador na nuvem).
- **nod:** dois executores no mesmo SPI — **`catcher`** (simulador grátis, para dev/CI custo zero) e
  **`claude-cli`** (real). Um provedor só por ora. O `catcher` (rodar o produto inteiro sem gastar
  nada) é uma ideia bem específica do nod.

### 7. Distribuição

- **OMB:** apps Electron (DMG/EXE/DEB), `npx serve` para VPS, Docker — servidor e máquina **podem**
  ser separados.
- **nod:** servidor e máquina são o **mesmo processo** hoje (ADR-020 invertido); sem
  mobile/PWA/Electron/updater. Um container, web obrigatória.

## Resumo

| # | Eixo | OpenMausBot | nod |
|---|---|---|---|
| 1 | Direção da conexão | algo de fora alcança a máquina (companion, computer control) | a máquina sempre disca; servidor nunca liga (ADR-021) |
| 2 | Raio de dano | mouse/teclado, shell, arquivo, desktop na nuvem | 9 ferramentas + conectores MCP, tudo gated pelo proxy (ADR-028) |
| 3 | Autoridade da decisão | local, montagem lê config local | local + **plano de turno** do servidor; fail-closed estrutural (ADR-024) |
| 4 | Persistência/auditoria | logs NDJSON; estado em memória | Postgres, RLS 2 camadas, trilha imutável, autoria composta |
| 5 | Credenciais | chaves em texto puro no `config.json` | env cifrado; CLI resolve a própria; denylist anti-carona (ADR-015) |
| 6 | Executor/provedores | multi-provedor (Claude, Codex, Grok, nuvem) | catcher (grátis) + claude-cli, um SPI |
| 7 | Distribuição | Electron, `serve`, Docker; servidor e máquina separáveis | mesmo processo; web obrigatória (ADR-020) |

**Numa frase:** o OpenMausBot é uma **plataforma de bots que agem no mundo**; o nod é uma **camada de
decisão auditável** — a mesma família de peças (harness, drivers, proxy MCP, registry, SSE), montada
com o parafuso girando para o lado oposto.
