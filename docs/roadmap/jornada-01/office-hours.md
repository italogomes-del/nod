# Jornada 01 — O bot ganha mãos: controle de computador e capacidades de operador

> **Estado:** rascunho detalhado · **Definida em:** 2026-09-16 · **Cobre:** Ponto 1 (alcance) +
> Ponto 2 (raio de dano) das features do OpenMausBot.
>
> **Quebra em épicos:** [epicos.md](epicos.md). · **Quebra em issues:** [issues.md](issues.md).

## Norte / valor para o usuário

Hoje o bot do nod é um **assessor**: rascunha e pergunta, sem mãos no sistema. Esta jornada o
transforma num **operador**: ele passa a **agir no mundo** — rodar comandos, editar arquivos, dirigir
uma tela, navegar e tocar apps externos — mantendo a rede de segurança do nod (aprovação item a item,
trilha inapagável, o bot sempre consegue te perguntar).

Equivale às capacidades do OMB descritas nos Pontos 1 e 2, **menos Companion**.

## Persona & pré-condições

- **Persona:** Marlon, colaborador da Leapy, quer que um bot execute uma tarefa real de ponta a ponta
  (ex.: "clone o repo X, rode os testes, e me diga o que quebrou") sem ele digitar cada comando.
- **Pré-condições:** sessão real (não o stub de cookie de hoje); um agente criado; e, para controle
  local, um **opt-in explícito** da pessoa naquela máquina.

## A jornada, passo a passo (perspectiva do usuário)

1. **Você dá uma tarefa que exige mãos.** No chat com o bot: *"Suba um ambiente, clone `leapy/api`,
   rode a suíte e me traga os testes vermelhos."*
2. **Você escolhe ONDE ele ganha mãos.** Um seletor no turno:
   - **Nesta máquina** (macOS, ou Ubuntu Xorg) — exige o opt-in explícito daquela máquina; ou
   - **Num desktop na nuvem** — sobe sozinho, com **preview da tela ao vivo** enquanto ele trabalha
     (equivalente ao painel "Computer" do OMB, chave de provedor em Ajustes).
3. **O bot começa a operar e você acompanha.** No desktop na nuvem, você vê a tela; na máquina local,
   você vê o log de ações. As ações de baixo risco (ex.: `ls`, ler arquivo) correm direto.
4. **Ação arriscada pausa e vira um card.** Quando o bot vai rodar `rm`, escrever num arquivo, ou um
   comando de shell sensível, **o turno para** e aparece um **card inline**: a ação proposta, e os
   botões **Liberar / Recusar** (e responder, se for uma pergunta). Nada arriscado roda sem o seu ok.
5. **O bot toca um app externo.** Precisa abrir uma issue no GitHub ou mandar um Slack: usa um
   **conector** (OAuth, estilo Composio). Na primeira vez, você autoriza o app; depois, é o card de
   aprovação de sempre.
6. **Você pode parar a qualquer momento.** "Parar" encerra o processo (e, no desktop na nuvem, congela
   as mãos) em menos de 2 s.
7. **No fim, o cartório.** O resultado chega ao chat, e a **trilha** registra cada ação, cada
   aprovação (quem liberou, quando) e cada negação — inapagável.

## Capacidades introduzidas (de → para)

| Feature do OMB | Hoje no nod | Nesta jornada |
|---|---|---|
| Controle da máquina local (mouse/teclado/shell) | inexistente (ADR-028) | ferramentas de operador locais, atrás de opt-in por máquina |
| Desktop na nuvem + preview ao vivo | inexistente | desktop remoto **no modelo VPS** (mãos remotas, cérebro local) |
| Shell / edição de arquivo | inexistente | ferramentas no catálogo do plano, com `readOnlyHint` e tier de confiança |
| Browsing | inexistente | ferramenta de browser no catálogo, gated pelo proxy |
| 500+ apps (Composio, OAuth) | conectores MCP com env cifrado | broker OAuth estilo Composio, além do MCP registrado |
| Permission broker (cards Allow/Deny) | aprovação tipada item a item (já existe) | estende a mesma lista para shell/arquivo/desktop — sensível nasce desmarcado |

## Fora de escopo (explícito)

- **Companion / pareamento desktop-a-desktop via Tailscale.** Decisão do dono (2026-09-16): a única
  feature do OMB que o nod não persegue.
- **Modelo "boxagent"** em que o turno inteiro roda na máquina remota. Rejeitado — ver a linha
  vermelha abaixo.

## Impacto arquitetural & ADRs afetados

Esta jornada **reverte, pela porta da frente**, decisões da fundação. Cada uma tinha gatilho:

- **ADR-028 (nenhum turno roda fora da máquina do proxy) — REVERTIDO PARCIALMENTE.** O gatilho do
  próprio ADR-028 já previa o caminho: *"se um dia houver computador dedicado, ele segue o modelo VPS
  — processo do agente e proxy permanecem locais, apenas as MÃOS são remotas."* Seguimos exatamente
  esse modelo. **NÃO** adotamos o modelo `boxagent` (turno inteiro remoto), porque ele quebra a linha
  vermelha do roadmap.
- **ADR-013 (o proxy é o ponto de decisão) — PRESERVADO, sobrecarregado.** As novas capacidades
  entram como **ferramentas no catálogo do plano de turno** (ADR-024), com tier de confiança e
  `readOnlyHint`. O proxy continua sendo quem libera/corta/nega. A arquitetura do plano **acomoda**
  isto sem quebrar: shell e browser são só ferramentas de alto poder que o porteiro passa a gatear.
- **ADR-015 (credenciais) — ESTENDIDO.** O broker OAuth estilo Composio é um segundo regime de
  credencial além do MCP com env cifrado. Precisa de decisão nova sobre onde o token OAuth mora.
- **ADR-019 (sonda / credencial local) — TOCADO.** O opt-in de controle local e o runtime de
  automação (equivalente ao Cua Driver) precisam de uma sonda de disponibilidade própria.

**A linha vermelha (não-negociável):** o bot precisa sempre conseguir **te perguntar**. Por isso o
desktop na nuvem segue o modelo VPS (o caminho de volta pessoa↔agente nunca some). Se uma
implementação fizer o agente virar `"unavailable"` para perguntas (como o `boxagent.ts:294` do OMB),
ela está errada por construção, não por bug. O racional completo (modelo A × B, com as citações do
código real do OMB) está em [Pré-ADR-030](../pre-adr-030-maos-remotas-modelo-vps.md) — que vira o ADR
definitivo quando esta jornada for construída.

## Critérios de aceite

1. Um bot roda uma tarefa multi-passo (clonar → testar → reportar) **na máquina local** com opt-in, e
   toda ação de shell sensível passa por um card **Liberar/Recusar**.
2. A mesma tarefa roda **num desktop na nuvem** com preview ao vivo, e o bot **consegue fazer uma
   pergunta à pessoa** no meio (prova do modelo VPS).
3. "Parar" encerra em < 2 s em ambos os modos.
4. Cada ação, aprovação e negação vira linha na **trilha** inapagável, com autoria composta.
5. Nenhuma capacidade nova aparece no `tools/list` sem plano válido (fail-closed preservado).
6. **Companion não existe** em lugar nenhum do código.

## Perguntas em aberto

- Onde mora o token OAuth do broker de conectores (servidor cifrado? Keychain da pessoa?) — decide o
  ADR-015 estendido.
- Qual runtime de automação de desktop (equivalente ao Cua Driver) e sua licença/proveniência.
- Preview da tela ao vivo: por onde trafega o vídeo sem reabrir a discussão de "algo alcança a
  máquina"? (No modelo VPS a máquina remota é do provedor de nuvem, não a sua — resolver isto no
  design.)
- Sessão real (Google Workspace restrito a leapy.com.br) é pré-requisito e hoje é só um stub.
