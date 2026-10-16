# Plano: tela limpa e troca de conta/IA no limite

Decisões do Marlon de 15 e 16/10/2026, aprovadas em 16/10 por volta das 02:20 ("estou satisfeito com todas as decisões").

- Canvas: https://claude.ai/artifact/MJsGJJUjvfM8A1kaXVQZdv
- Registro das decisões: `~/code/nod-prototipos/2026-10-15-limite-e-troca/DECISOES.md`
- Diagnóstico do caso que originou tudo (Eng 1, 15/10 20:39): https://claude.ai/artifact/JtY37J93ADLncDcc82qRzn

O trabalho vai em **dois PRs**, porque a parte de regras disputa os mesmos arquivos com #319, #322, #332, #337 e #329. A tela entra primeiro, com risco baixo. As regras vêm depois, rebaseadas sobre o que estiver na main.

## PR 1 — a tela do chat, mais limpa (só web, mais uma leitura nova)

| # | O quê | Onde |
|---|---|---|
| T1 | O cabeçalho vira uma pílula flutuante: mascote + nome + ponto de presença, centrada sobre o chat. No hover, borda `--ink` e "›" (o `--signal` é reservado ao que é novo, `tokens.css:9-11`). O clique alterna o painel (`data-act="alternar-detalhes"`, `aria-expanded`). A presença completa ("Trabalhando · 2 esperam você", "sem novidade há N min") vai para o `title`/`aria-label` e para um subtítulo curto embaixo da pílula quando não for "Disponível". | `web/telas/conversa.ts` `renderCabecalhoConversa`; `main.ts:897-908` (classe `cabecalho-pilula`, escopada à conversa); `interface.css` |
| T2 | MODO DEV, "Hoje com", "Linhas abertas" e Ligar saem do topo e vão para a gaveta: uma seção nova na `visaoGeral`; Ligar entra em Atalhos. **Parar** vai para o composer: o botão Enviar vira Parar quando há turno vivo ou task aberta. | `detalhes.ts`, `modo-dev.ts`, `ligacao.ts`, `conversa.ts` `htmlComposer`, `main.ts` `atualizarComposer` |
| T3 | Gradiente no topo: o texto esmaece por baixo da pílula, só com tokens (`var(--surface)` → `transparent`). A `.timeline-wrap` ganha `padding-top`. | `interface.css` |
| T4 | Composer com 760 px, igual à coluna, e borda fina `--line` + sombra leve (token novo `--shadow-composer` no claro e nos dois escuros). A coluna `.timeline` também vai para 760. A faixa da linha do dono acompanha. | `estilos.css`, `interface.css`, `tokens.css` |
| T5 | Sai a dica "Enter envia · Shift+Enter…". Fica só a nota do modo resposta ("Sua próxima mensagem responde à pergunta…"), que é informação real. | `conversa.ts:948-956`, `pergunta.ts:214-226`, `main.ts:1084-1086` |
| T6 | Seletor de IA no composer, entre o texto e o microfone. O botão mostra o logo com o anel de uso da janela de 5 h + "Auto · Opus" (Automático) ou "Opus" (fixo); acima de 90% o anel fica âmbar e mostra o número. O menu (padrão do `menu-modo.ts`, listener próprio) tem: o cabeçalho com a conta e o uso; "Automático"; os modelos de cada IA (um clique fixa o bot); a régua de raciocínio com os níveis do modelo do momento (`raciocinios` de `HARNESSES`, nomes de `RACIOCINIOS`); o link "Fila de contas e regra de troca" para Provedores. Grava em `PUT /agentes/:id/inteligencia` (`pedidoDoMenu`/`pedidoDoRascunho`). A linha "Inteligência" da gaveta continua (o nível 2B de ordem fica). | `web/telas/seletor-ia.ts` (novo), `web/lib/menu-ia.ts` (novo), `conversa.ts`, `main.ts`, `api.ts` (+`usoDoPlano`), `reducer.ts` (+`usoDoPlano`, `contasIa` também na conversa) |
| T7 | Avisos sem bege: `.tom-alerta` e `.linha-espera` passam a cartão/pílula `--surface` com borda `--line`; o âmbar fica só no ícone (`--warning`). O botão primário do alerta vira `--action`. | `estilos.css:141-145`, `interface.css:1409-1412` |
| T8 | Provedores: o ⋯ aparece só no hover/foco/menu aberto. Em toque, fica sempre visível. | `navegacao.css:682-684` |

Testes que mudam: `modo-dev`, `ligacao`, `chat-limpo`, `conversa-depois`, `turnos-fantasmas`, `vigia-tela` (cabeçalho), `perguntas-conversa`, `fio-da-pergunta` (nota), `cores-por-token` (token novo). Testes novos: render da pílula, do seletor (Automático/fixo/níveis por modelo/anel âmbar) e do menu.

## PR 2 — a regra do limite (servidor + web)

Emenda às ADR-036, 101 e 102 e às decisões NOD-221, 223 e 224, na **ADR-108**. Migração **0080**, confirmada no rebase.

| # | Decisão | Implementação |
|---|---|---|
| R1 | **A lista é a fila.** Cada conta tem "na fila" (liga/desliga). Ao acabar, o Nod passa sozinho para a próxima conta da mesma IA na fila, sem perguntar. Some o "Perguntar antes / Trocar sozinho". | `entraNaTroca` = `entraNaTrocaAutomatica`; `contaEmUsoDaIa`/`contaDoTurno`/`decidirLimiteDaConta` sem `modo` (o `modo` fica no contrato, ignorado, para app antigo). Migração 0080: backfill `entra_na_troca_automatica = true` na 1ª conta pessoal de cada IA. **Termos de uso (ADR-101 §4):** a 2ª+ conta da mesma IA e a corporativa nascem fora da fila, e ligar uma delas mostra o aviso dos termos (o mesmo de hoje ao ligar "Trocar sozinho"). A pessoa consente uma vez por conta. Conta fora da fila só entra por escolha explícita ("Seguir com"). |
| R2 | **Outra IA só no Automático.** Bot com modelo fixo nunca troca de IA. | `iaFixa` no domínio, como o #337 (`semContaParaOTurno` filtra pela IA fixa). Se o #337 entrar antes, reaproveitar. |
| R3 | **Conversa no Automático troca na hora** (já é assim). | Nada além do rebase sobre o #319. |
| R4 | **Task com sessão não troca de IA sozinha.** Ela espera (retomada com `acordar_em` = volta) e o bot ganha **um aviso** com recomendação. Volta em até 30 min → "esperar"; mais longe **ou sem hora** → "levar para <IA>". Botões "Esperar o Claude" / "Levar as tasks para o ChatGPT" (recomendado marcado). Sem resposta: "esperar" não faz nada; "levar" é aplicado sozinho depois de 10 min. Task sem sessão na IA que parou troca sem perguntar. | Assentamento: `aposLimiteDaConta` com `outra_ia` + `trabalhoId` + sessão na IA que parou → `aposLimiteNoFundo(renovaEm = volta)` + `registrarTrocaPendente`. Despacho/plano: guarda em `emitir-plano-turno`/`despachar-turno` para não entregar turno de task com sessão na IA no limite a outra IA (devolve à espera). Tabela nova `trocas_de_ia` (0080, `nod_escopar_tabela`, índice único parcial por agente enquanto aberta): `agente_id, ia_de, ia_para, recomendacao, volta_em, aplicar_em, decidido_em, decisao, mensagem_id`. Mensagem de sistema com payload `{kind:"troca_de_ia", …}` na conversa do bot. Rota `POST /agentes/:id/troca-de-ia {decisao}`. Bloco novo no `varredor-expiracao`: aplica "levar" vencido e fecha a troca quando a conta volta. "Levar" reescreve `harness`/`modelo` dos turnos pendentes com `trabalho_id` do bot na IA que parou e zera `acordar_em` só das esperas da cota (prefixo `ENTRADA_DA_VOLTA_DA_COTA`). |
| R5 | **Trocar a IA do bot pelo seletor com tasks em andamento:** prévia "Muda agora / As N tasks…" com "Só daqui em diante" (padrão) ou "Levar as tasks também". | `PUT /agentes/:id/inteligencia` aceita `levarTasks?: boolean` (separado no caso de uso antes de `aplicarPedidoInteligencia`). Mesma operação de repositório do R4. A web conta as tasks abertas do bot (`abertosDoBot`) para a prévia. |
| R6 | **Bot fixo sem conta da IA dele na fila:** o aviso diz o estado ("parado até 13:00"), avisa que ele volta sozinho e oferece dois caminhos: "Continuar na conta <fora da fila>" e "Continuar no <outra IA> até <volta>". | O primeiro é o "Seguir com" estendido a tasks: grava a escolhida e acorda as retomadas daquele bot. O segundo: bot vai para `auto` + "levar as tasks" + `trocas_de_ia.volta_ao_fixo` (jsonb com a inteligência anterior). O varredor restaura quando a conta volta. |
| R7 | **Mesma IA, só troca de conta:** linha leve, sem cartão ("marlonwlv acabou → seguindo no Claude · Marlon 20x · mesmo modelo"). As tasks seguem na hora (no Claude a sessão é compartilhada; no Codex segue pelo histórico). | O payload `conta_seguiu` já existe. Só o texto e o estilo neutro, e as tasks usam `renovaEm = agora` (já é assim com `trocou`). |
| R8 | Provedores sem regra para configurar: a lista com liga/desliga e três linhas que explicam como o Nod age. | `contas-lista.ts`: sai `.cl-modo`; o opt-in passa a valer para toda conta (`PATCH /contas-ia/:id {entraNaTrocaAutomatica}` já existe). |

Fora deste trabalho, registrado para depois: o caminho do app do Mac (ADR-101, `resultado.contaNoLimite`) segue igual; a ligação de voz (troca de IA mesmo com bot fixo); a honestidade do bot sobre o estado das tasks.

## Testes

- **Unit:** domínio `contas-da-pessoa` (fila sem modo, R1/R2), recomendação (`recomendacaoDaTroca(voltaEm, agora)`: ≤30 min → esperar, >30 min ou nulo → levar), web (seletor, aviso de troca, prévia).
- **Integração** (withRollback, banco efêmero 5441): `trocas_de_ia` (única aberta por agente), "levar" reescreve só pendentes do bot com `trabalho_id` e só zera `acordar_em` das esperas da cota, PUT inteligência com `levarTasks`, backfill da 0080.
- **Concorrência:** varredor aplica "levar" vencido uma vez só; decisão manual e varredor ao mesmo tempo resultam em uma aplicação.
- **Conformidade:** RLS da tabela nova, rollback ida e volta da 0080.
- **QA (/qa):** web com o banco efêmero e o catcher, no Chrome headless. As capturas das telas 1, 2, 3, 4, 5, 7, 9 e 12 do canvas são comparadas lado a lado com os quadros do protótipo, já que o canvas é a referência de fidelidade.

## Entrega

PR 1 → CI verde → merge → deploy automático. PR 2 → rebase → CI verde → merge. Depois, PR de versão (`0.4.0-rc.13`) e `npm run release:mac`. O app do Mac carrega a web do servidor, então a tela chega pelo deploy; a release leva o que mudou no `desktop/`.

---

# Revisão de engenharia (/plan-eng-review, 16/10/2026 ~02:50, autônoma)

Alvo: `docs/plano-limite-e-troca.md`. O Marlon pediu para rodar "no modo sem entrevista e com autonomia". Por isso, cada decisão abaixo é a opção recomendada, escolhida automaticamente e registrada aqui.

## Scope Challenge

- **Reuso.** Já existem e são reaproveitados, sem reescrever:
  - as funções puras da seleção de IA (`inteligenciaDoBot`, `iaEmUso`, `pedidoDoMenu`, `niveisDoModelo` em `web/telas/inteligencia.ts`);
  - a rota `PUT /agentes/:id/inteligencia`;
  - o padrão de popover do chip de modo (`web/lib/menu-modo.ts`);
  - o `PATCH /contas-ia/:id {entraNaTrocaAutomatica}`;
  - o varredor de 30 s (`src/adapters/fundo/varredor-expiracao.ts`);
  - as notas com botão (`criarNotaDeContas` → `linhaContasNoLimite`).
- **Complexidade.** São cerca de 25 arquivos e 2 componentes novos (o seletor de IA na web e as trocas de IA no servidor), o que dispara o gate de complexidade.
  - Arranjo menor, escolhido automaticamente: dois PRs (tela e regra), sem cortar funcionalidade. O PR 1 é só web mais a leitura do uso; o PR 2 é a regra.
  - Registro de escopo: `feature answers: auto (todas mantidas); structure: B (dois PRs); accepted scope: plano inteiro; pending remedies: none`.
- **Resultado:** scope accepted as-is (o arranjo menor não reduz escopo).

## Decision ledger

Cada item traz o achado e a decisão escolhida automaticamente (a recomendada).

- **E1 (P1, 9/10) `src/use-cases/emitir-plano-turno.ts:164-174`.** No plano, a task pendente de um bot em Automático vai para a outra IA mesmo que o assentamento a segure, porque a IA sem conta entra em `noLimite`.
  - **Decisão:** guarda também no despacho. Turno com `trabalho_id` cuja sessão (`trabalhos.sessao_harness`) é da IA no limite não troca de IA sem decisão. Ele volta a esperar (`acordar_em` = volta) e registra ou atualiza a troca pendente. Teste de integração dos dois caminhos.
- **E2 (P1, 8/10) `docs/adr/adr-101…:61-84` + `src/domain/contas-da-pessoa.ts:15-17`.** Trocar sozinho entre contas da mesma IA ficou opt-in por causa dos termos de uso (OpenAI: "circumvent rate limits"; Anthropic: "ordinary, individual usage").
  - **Decisão:** a fila é o consentimento.
    - A 1ª conta pessoal de cada IA nasce na fila.
    - A 2ª em diante e a corporativa nascem fora; ligar mostra o aviso dos termos (o texto de hoje).
    - O backfill da 0080 respeita quem já usava "Trocar sozinho": liga todas as pessoais.
  - A validação jurídica fica sinalizada no PR e na ADR-108.
- **E3 (P2, 8/10) `emitir-plano-turno.ts:210-218`.** No Codex, trocar de conta perde a sessão.
  - **Decisão:** na mesma IA, a task segue na hora em qualquer provedor (no Codex, pelo histórico, como hoje). Só a troca de **IA** passa pela recomendação. Fica registrado na ADR.
- **E4 (P2, 8/10) `contas-da-pessoa.ts:50-52`.** Hoje a 1ª conta é usada mesmo sem estar na troca.
  - **Decisão:** a escolha automática só considera contas na fila, em ordem. Conta fora da fila só entra por escolha explícita (`contas_escolhidas`, "Seguir com").
  - Se nenhuma conta da IA estiver na fila, usa a escolhida; sem escolhida, a 1ª da lista, para a pessoa não ficar sem IA no primeiro uso.
- **E5 (P2, 9/10) `web/tokens.css:9-11`.** O `--signal` é reservado ao que é novo.
  - **Decisão:** no hover, a pílula ganha borda `--ink` e "›", sem azul.
- **E6 (P2, 9/10) A web não tem o uso da janela.** O `GET /uso-do-plano` existe, mas a web não lê.
  - **Decisão:** `api.usoDoPlano()`, um campo no estado e invalidação no mesmo frame que já invalida `ias`. O anel mostra a `utilizacao` da janela de 5 h da IA em uso.
- **E7 (P2, 8/10) Migração.** Os números 0076, 0077 e 0079 estão disputados em PRs abertos.
  - **Decisão:** 0080, renumerando no rebase se preciso.
- **E8 (P3, 7/10) `src/domain/inteligencia.ts:219`.** O `aplicarPedidoInteligencia` rejeita chave desconhecida.
  - **Decisão:** separar `levarTasks` no caso de uso antes de aplicar o pedido. O contrato da rota ganha o campo opcional.
- **E9 (P2, 8/10) PRs abertos nos mesmos arquivos.** #319, #337 e #329 também mexem em `assentar-turno`, `contas-do-turno`, `despachar-turno` e `contas-lista`.
  - **Decisão:** o PR 1 (web) entra primeiro. O PR 2 sai da main do momento, com rebase antes do merge. Comentar nos PRs #337 e #329 o que mudou na regra.
- **E10 (P3, 7/10) `pergunta.ts:223`.** A nota "Enter envia" também carrega o texto do modo resposta.
  - **Decisão:** some só a dica padrão; a nota do modo resposta fica.
- **E11 (P2, 8/10) O Parar sai do cabeçalho.**
  - **Decisão:** no composer, o Enviar vira Parar quando há turno vivo ou task aberta. Usa o mesmo `data-act="parar-conversa"` e alterna por `hidden`, como o `parar-trabalho`.

Approval readiness: PASS (E1–E11, decididos automaticamente sob a autorização do Marlon de 16/10 02:20).

## 1. Arquitetura

- [P1] (9/10) `emitir-plano-turno.ts:164-174`: a task vaza para outra IA no plano. Ver E1.
- [P2] (8/10) `contas-da-pessoa.ts:45`: `entraNaTroca` = `!corporativa || flag` passa a significar "na fila". Ver E2 e E4.
- Fluxo novo:

```
limite na conta C (IA X) ─┬─ outra conta de X na fila? ── sim ─▶ segue nela (conversa e task), linha leve
                          └─ não ─┬─ bot fixo ─▶ espera; aviso "parado até HH:MM" + [conta fora da fila] [outra IA até a volta]
                                  └─ Automático ─┬─ conversa ─▶ troca de IA na hora (como hoje)
                                                 └─ task com sessão em X ─▶ espera + troca_de_ia(recomendação)
                                                        ├─ volta ≤ 30 min ─▶ recomenda esperar (sem resposta: nada)
                                                        └─ volta > 30 min ou sem hora ─▶ recomenda levar (sem resposta: aplica em 10 min)
varredor 30 s: aplica "levar" vencido; fecha a troca quando a conta volta; restaura o modelo fixo temporário
```

- **Falha realista:** o varredor aplica "levar" no mesmo instante em que a pessoa clica "Esperar". Resolve com índice único parcial e `UPDATE … WHERE decidido_em IS NULL`: quem chega primeiro vence e o outro vira no-op. Tem teste de concorrência.

Dispositions: E1 accepted, E2 accepted, E4 accepted.

## 2. Qualidade de código

- [P3] (7/10) O `inteligencia.ts` da web já tem toda a lógica do menu. O seletor do composer reaproveita as funções puras em vez de copiar: é reuso, sem extração nova.
- [P2] (8/10) `aplicarPedidoInteligencia` é estrito. Ver E8.
- [P3] (7/10) `pergunta.ts:223`. Ver E10.

Dispositions: accepted.

## 3. Testes

```
CODE PATHS                                              USER FLOWS
[+] domain/contas-da-pessoa (fila)                      [+] Limite na conversa (Automático)
  ├── [GAP] contaEmUsoDaIa só na fila, em ordem           ├── [★★ TESTED] troca de IA na hora — concurrency/limite-troca-ia
  ├── [GAP] decidirLimiteDaConta sem modo                 └── [GAP] linha leve "seguindo no <conta>"
  └── [GAP] iaFixa nunca devolve outra_ia               [+] Limite numa task (Automático)
[+] domain recomendacaoDaTroca                            ├── [GAP] [→E2E] espera + aviso com recomendação
  ├── [GAP] ≤30 min → esperar                             ├── [GAP] clicar "Levar" → turnos reescritos
  └── [GAP] >30 min / nulo → levar                        └── [GAP] sem resposta 10 min → aplicado uma vez
[+] use-cases/trocas de IA                              [+] Bot fixo sem conta
  ├── [GAP] registrar (única aberta por bot)              └── [GAP] "outra IA até a volta" + restauração
  ├── [GAP] levar: só pendentes com trabalho_id do bot  [+] Seletor no composer
  └── [GAP] esperar: no-op idempotente                    ├── [GAP] Automático / modelo fixo grava inteligência
[+] despacho/plano guarda E1                              ├── [GAP] régua mostra só níveis do modelo
  └── [GAP] [→E2E] task com sessão não sai na outra IA    └── [GAP] prévia com tasks → levarTasks
[+] migração 0080 (backfill + tabela)                   [+] Provedores
  └── [GAP] rollback ida e volta (conformidade)           └── [GAP] ligar 2ª conta mostra aviso dos termos

COVERAGE (antes): 1/17 · QUALITY: ★★:1 · GAPS: 16 (2 E2E)
```

Todos os GAPs viram testes no PR correspondente: as decisões E1–E11 trazem seus testes.

Testes a retirar: os que afirmam "Perguntar antes" ou "Trocar sozinho" são reescritos para a fila (`contas-da-pessoa.test.ts:51-116`, `contas-no-turno.test.ts:60,73`, `contas-lista.test.ts:141,288`, `contas-ia.test.ts:162,174`). Os do caminho do app do Mac (ADR-101, `assentar-turno-contas.test.ts`) ficam.

## 4. Desempenho

- **Varredor:** a cada 30 s, uma consulta por pessoa em `trocas_de_ia` abertas com `aplicar_em <= now()`. Usa o índice parcial `(tenant_id, aplicar_em) WHERE decidido_em IS NULL`. O volume é de dezenas de linhas por pessoa, no máximo.
- **"Levar":** um UPDATE por bot, limitado aos pendentes dele. Sem N+1.
- **Web:** busca `GET /uso-do-plano` só quando o frame de `ias` invalida. Não há polling novo.

Nenhum problema além dos índices citados.

## Outside voice

O Codex não está instalado neste Mac, e o fallback nativo exige TaskOutput, indisponível nesta sessão. Outside voice unavailable: não há cobertura externa, e isso não conta como revisão limpa.

## NOT in scope

- **Caminho do app do Mac** (ADR-101, `resultado.contaNoLimite`): segue igual.
- **Ligação de voz trocando de IA com bot fixo** (achado de 15/10): fica para uma issue própria.
- **O bot afirmar o que não fez** ("Retomei as 19 frentes com ChatGPT"): fica para uma issue própria.
- **Tela Trabalhos com pílula por task:** fica para depois; o protótipo é aproximado.

## Failure modes

| Caminho | Falha realista | Coberto | Silencioso? |
|---|---|---|---|
| varredor aplica "levar" | corrida com o clique em "Esperar" | teste de concorrência + UPDATE condicional | não |
| backfill da 0080 | pessoa sem conta pessoal (só corporativa) | fallback E4 (1ª da lista) + teste | não |
| guarda no plano | task sem sessão ficar presa esperando | o critério exige sessão na IA no limite + teste | não |
| restauração do modelo fixo | a conta volta e o varredor cai | idempotente por `decidido_em`/`restaurado_em`; o próximo tique repete | não |

Critical gaps: 0.

## Worktree parallelization

| Step | Modules | Depends on |
|---|---|---|
| A: tela (PR 1) | web/telas, web/lib, web/*.css, web/main.ts | — |
| B: domínio + repositório + migração (PR 2) | src/domain, src/repositories, src/db | — |
| C: casos de uso + varredor + rotas (PR 2) | src/use-cases, src/adapters | B |
| D: web das regras (PR 2) | web/telas (ia-fora, contas-lista) | A, C |

Ordem das lanes: A e B em paralelo; depois C; depois D. Conflito: A e D mexem em `web/main.ts`, então rodam em sequência.

## Implementation Tasks

- [ ] **T1 (P1, human ~2d / CC ~1h)** — web — pílula, gradiente, composer de 760 px, nota, Parar no composer, avisos sem bege, kebab no hover (PR 1). Verify: unit web + QA visual.
- [ ] **T2 (P1, human ~2d / CC ~1h)** — web — seletor de IA no composer com Automático, modelos, régua por modelo, anel de uso e prévia (PR 1; `levarTasks` liga no PR 2). Verify: unit web.
- [ ] **T3 (P1, human ~1d / CC ~40min)** — domínio e migração — fila sem modo, iaFixa, recomendação, 0080 (PR 2). Verify: unit + conformidade.
- [ ] **T4 (P1, human ~2d / CC ~1h)** — casos de uso — trocas de IA (registrar, esperar, levar, aplicar a vencida, restaurar), guarda E1, `levarTasks` no PUT, rotas (PR 2). Verify: integration + concurrency.
- [ ] **T5 (P1, human ~1d / CC ~40min)** — web das regras — aviso com recomendação, bot fixo com dois caminhos, linha leve na mesma IA, Provedores sem modo + aviso dos termos ao ligar (PR 2). Verify: unit web + QA.
- [ ] **T6 (P2, human ~2h / CC ~15min)** — docs — ADR-108 (emenda às ADR-036, 101 e 102 e a NOD-221, 223 e 224).

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (dois PRs)
- Architecture Review: 2 issues found
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 16 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written (Scope Challenge)
- TODOS.md updates: 0 items (o que ficou fora de escopo vira issue)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0
- Outside voice: codex, unavailable (não instalado; fallback nativo sem TaskOutput)
- Parallelization: 4 lanes, 2 parallel / 2 sequential
- Lake Score: N/A

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (plan-review) | Independent 2nd opinion | 0 | unavailable | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 21 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, unavailable (CLI ausente).
- **VERDICT:** a Eng Review tem achados mapeados em tarefas (issues_open aqui é trabalho mapeado, não bloqueio); o desenho veio do canvas aprovado pelo Marlon.

NO UNRESOLVED DECISIONS
