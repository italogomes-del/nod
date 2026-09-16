# Pré-ADR-030 — Mãos remotas seguem o modelo VPS: cérebro local, mãos remotas

> **Status:** proposto (rascunho) · **Origem:** [Jornada 01](jornada-01-o-bot-ganha-maos.md);
> comparação `boxagent.ts` × `vps-computer.ts` do OpenMausBot · **Data:** 2026-09-16
>
> Este é um **pré-esboço**: mora no roadmap, não em `docs/adr/`, porque a decisão ainda não foi
> construída. Quando a Jornada 01 virar código, este arquivo vira o ADR-030 definitivo (ou o número
> livre da época) e sai do roadmap. Refina o **ADR-028**.

## Decisão

Quando um turno do nod operar um computador que não é a máquina da pessoa (desktop na nuvem ou VPS),
ele segue o **modelo VPS**: o **processo do agente e o proxy MCP permanecem locais**; só as **mãos**
(mouse, teclado, captura de tela) são remotas, alcançadas por um transporte que a máquina local
inicia. É **proibido** o modelo em que o turno inteiro emigra para a máquina remota. O critério de
aceite é mecânico: **se, no meio de um turno remoto, o agente não conseguir emitir `pedir_a_pessoa` /
`pedir_aprovação` e receber a resposta de volta, a implementação está errada** — e errada por
construção, não por bug.

## Contexto

O ADR-028 fechou a porta para "turno inteiro na máquina remota" e já apontou o caminho compatível: o
modelo VPS. Este pré-ADR eleva aquilo de *nota de rodapé de um ADR de não-fazer* para *decisão de
desenho de uma feature que agora VAMOS fazer* (Jornada 01, controle de computador). A garantia em
jogo é a linha vermelha do roadmap: o bot precisa sempre conseguir escalar para a pessoa — é o que
faz "quem decide é a pessoa" continuar verdadeiro mesmo quando o trabalho roda longe.

Sem esta decisão escrita, a implementação da Jornada 01 tenderia ao caminho mais curto (embarcar o
agente na máquina remota, como o OMB faz), e a perda do caminho de volta seria descoberta tarde,
quando já fosse estrutural.

## Alternativas rejeitadas

### Modelo A — "o cérebro viaja" (embarcar o agente na máquina remota, como o `boxagent` do OMB)

O turno inteiro roda na máquina remota. É o caminho mais curto e é o que o OMB faz no desktop na
nuvem. **Rejeitado**: mata o caminho de volta pessoa↔agente. No OMB isso não é acidente — o driver
**desliga** perguntas de propósito (ver Evidência). Uma vez escolhido, não há patch que devolva o
"perguntar" sem trazer o cérebro de volta — e trazer o cérebro de volta É adotar o modelo VPS. Logo,
escolher A é escolher perder a garantia permanentemente.

### Aceitar a degradação e só avisar "indisponível"

Deixar o turno remoto rodar e, quando ele precisar perguntar, renderizar um estado de indisponível.
**Rejeitado** pelo mesmo motivo do ADR-028: a degradação é silenciosa por construção e o teto de
conversa do nod (que escala para a pessoa e nunca tenta de novo) depende de existir caminho de volta,
não de um aviso.

## Evidência (verificada em 2026-09-16 no repositório do OMB)

- **Modelo A, no código do OMB** — `server/drivers/boxagent.ts`:
  - comentário do topo: *"the turn runs ON the bot's own cloud computer (box.ascii.dev), not on this
    machine"* — o turno inteiro roda na box;
  - tratamento de perguntas (linha ~294, número registrado pelo ADR-028):
    `respondToRequest: async () => "unavailable" as const` — qualquer pergunta do agente responde
    "indisponível". A leitura confirma: *"the remote box operates autonomously without pausing to
    query the user."*
- **Modelo B, no código do OMB** — `server/vps-computer.ts`, comentário do topo:
  *"The agent process stays local; Docker's own SSH transport reaches the user's daemon and the
  official Cua MCP server stays inside one managed container per bot."* — cérebro local, mãos remotas
  por SSH iniciado do lado local. É o modelo que este pré-ADR adota.

O OMB, portanto, **tem os dois modelos no próprio código**. Este pré-ADR não inventa o modelo VPS:
apenas fixa que a Jornada 01 usa o B e nunca o A.

## Consequências

- O desktop na nuvem da Jornada 01 precisa de um transporte iniciado pela máquina local até as mãos
  remotas (SSH/Docker no exemplo do OMB), e o proxy MCP continua local — o plano de turno (ADR-024) e
  o gate do proxy (ADR-013) seguem valendo sem exceção.
- `pedir_a_pessoa` / `pedir_aprovação` continuam funcionando idênticos ao turno local: o caminho de
  volta não muda de topologia entre local e remoto.
- Fecha a porta, de novo e agora com feature em construção, para o modelo `boxagent`. Dá o mesmo
  critério mecânico do ADR-028 para avaliar PRs: se o turno sai da máquina do proxy, a resposta é não.
- O preview de tela ao vivo trafega da máquina **do provedor de nuvem** (não a sua), então não reabre
  a discussão de "algo alcança a SUA máquina" — mas o design precisa dizer por onde o vídeo passa.

## Gatilho de reversão

Reabrir (permitir o modelo A, turno inteiro remoto) só se aparecer um caso em que **o agente remoto
comprovadamente NÃO precise nunca perguntar à pessoa durante o turno** — por exemplo, uma classe de
rotina noturna 100% autônoma, com desfecho binário e sem ação sensível, medida em produção. Nesse
caso, o modelo A é aceitável SÓ para aquela classe, e o produto precisa renderizar explicitamente que
aquele turno não tem caminho de volta (fail-closed renderizado, ADR-029). Fora disso, o modelo VPS é
obrigatório.

**Não** é gatilho: "o modelo A é mais simples de implementar" — a simplicidade é justamente o que
compra a perda da garantia.

## Reversibilidade

Alta enquanto nada estiver construído (é um pré-ADR). Depois de construído: média — trocar de VPS
para boxagent desfaz a linha vermelha do roadmap e o ADR-028.
