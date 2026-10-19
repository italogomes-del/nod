# Relatório forense do banco de produção do Nod

Data de referência: 2026-10-15. Dados lidos entre 15/10 01:30 e 09:57 BRT (varreduras read-only; logs do servidor de 14/10 09:00 até 15/10 00:24 BRT). Código de referência: worktree `nod-auditoria`, `origin/main` 81a1c532. Horários neste relatório estão em BRT. Ids são os 8 primeiros caracteres. Nenhum texto de conversa é reproduzido; pessoas não são nomeadas, bots são.

Cada achado passou por um autor (que varreu o banco) e por um cético (que releu o código e, em parte dos casos, reconsultou o banco). A severidade indicada é a do cético; quando o autor divergia, a dele vai entre parênteses. Onde o cético não recontou no banco, o achado diz isso.

---

## 1. Resumo executivo

O núcleo do Nod está íntegro no que diz respeito a consistência de estado: zero turnos com lease vencido fora do varredor (até 08:07 de hoje), zero elos quebrados nas cadeias de retomada, zero trabalhos com estado gravado diferente do derivado (1.149 de 1.149), outbox com 64.526 de 64.528 itens entregues e p50 de 0,3 a 0,5 s, e a taxa de sucesso dos turnos fora do dia 12/10 fica em 93,7 %. O que o banco revela de grave não é corrupção: é **espera silenciosa**. O sistema foi desenhado para segurar trabalho em vez de falhar (ADR-099 §7), e hoje ele segura sem dizer a ninguém que está segurando.

Os achados mais graves, em ordem:

1. **Servidor sem contato com nenhuma máquina desde 08:07 de hoje** (crítico, ao vivo). Varredor de lease, agendador e `puxar` pararam no mesmo segundo; um turno está `despachando` com lease vencido há mais de 100 min e 12 rotinas têm próxima execução no passado. Causa não encontrada no banco; precisa de olho no processo do container.
2. **Cota semanal do Claude esgotada (renova 16/10 13:00) segura 38 turnos de fundo há ~40 h** — 27 pedidos entre bots, 9 rotinas, 1 frente que a pessoa abriu — enquanto uma segunda conta Claude (Team) está logada, livre e ociosa, porque o portão da cota é por IA e não por conta. Ninguém é avisado: nem o dono, nem quem pediu, nem a lista de rotinas.
3. **Trocar a IA do bot não vale para o que já está na fila**: o turno carrega o harness de quando foi enfileirado. A rotina mais frequente do tenant (a cada 10 min) ficou um dia útil parada atrás de um turno Claude, embora o bot já fosse Codex e o Codex estivesse livre.
4. **Frente longa que cai por reinício do servidor ou máquina nunca é retomada**: `interromper` zera `lease_ate` e o varredor passa a ler a criação do turno como a hora da queda, desistindo em menos de 1 s. As 3 retentativas prometidas pela ADR-099 não acontecem para nenhuma frente com mais de 30 min de vida.
5. **Laço de reenvio sem teto** produziu 682 turnos e 682 avisos iguais em 32 min no dia 12/10. O caminho (`aposLimite`) continua sem trava no main.
6. **Frente "rodando" sem turno vivo**, esperando um colega preso na cota, pula uma rotina horária há 20 h sem nenhum registro.
7. **Rotina que delega a cada execução** empilhou 19 pedidos ao mesmo bot (9 num só turno); quando a cota voltar, saem todos em série.
8. **Custo por turno inflado** após `--fork-session` (até US$ 170 por turno, ~US$ 318 a 708 fantasmas em 21 dias) e **rótulo `executor='catcher'` errado** em 2.179 turnos — ambos contaminam métricas e o dicionário.

O que vale destravar à mão hoje (detalhe na seção 7): conferir e reiniciar o processo do servidor; responder as duas perguntas pendentes do bot Leonardo (uma delas bloqueia a rotina 57b9b36b até 13:15); corrigir o harness do turno dcdbf4af (ou pará-lo) para a rotina da Clarice voltar ao Codex; decidir o que fazer com os 19 pedidos duplicados ao Ze 1 antes de 16/10 13:00; e avaliar pôr a conta Team em primeiro lugar e mandar uma fala a um bot Claude para a leitura de cota se renovar (inferência pelo código, não testada).

---

## 2. Panorama em números (por varredura)

### 2.1 Relatos das pessoas
56 relatos entre 22/09 18:28 e 15/10 00:53, de 3 pessoas (53 de uma só). 49 pelo botão, 7 contados ao bot. Tipo: bug 50, melhoria 4, dúvida 1. Categoria: outro 45, nao_fez_o_pedido 4, interface 2, travou_ou_parou 1. 48 com turno, 50 com mensagem, só 3 com `turno_diagnosticos`. Versões: 0.2.0-rc.1 (37, até 02/10), 0.4.0-rc.1…rc.11 (12), sem versão (7). Bots mais citados: Chico 11, Clarice 11, Frida 5, Dev 1 4. Sinais fora dos relatos: 254 negações `sem_novidade args_invalidos` (parou em 07/10), 18 `devolver_resumo args_invalidos` (ativo 12–14/10), 24 `Monitor alcance_insuficiente`.

### 2.2 Turnos presos e anomalias de estado
9.806 turnos: concluído 8.484, interrompido 1.284, pendente 38, despachando 0 (às 05:20). Integridade limpa em todas as 14 checagens (lease vencido, terminais com lease, concluídos com motivo de interrupção, elos quebrados, decisões `retomar_turno` pendentes, esperas sem acordar). 1.450 cadeias de retomada, máx. 7 saltos. Os 38 pendentes: todos claude-cli/opus, `attempted=false`, alvo VM 309ec3dd online. Varredor de lease desde 09/10: p50 98 s entre queda e interrupção (dentro do desenho); antes, com o servidor no Mac que dormia, p90 de 19.507 s.

### 2.3 Como os turnos terminam (24/09 → 15/10)
8.961 turnos: 86,1 % concluídos, 13,4 % interrompidos. Sem a tempestade de 12/10, interrupção cai a 6,3 %. Motivos: limite_do_plano 771 (685 em 12/10), maquina_sem_contato 134, executor_indisponivel 80, absorvido 78, trabalho_incompleto sem motivo 43, reinicio_servidor 29 (zero desde NOD-214). Sucesso por origem: rotina 96,9 %, retomada 91,5 %, conversa 87 %, delegação 83,5 % (a mais frágil). Custo: US$ 7.296,76 em 21 dias, dos quais ~US$ 318 a 708 são artefato de bifurcação de sessão. `turno_diagnosticos`: 891 linhas; 'session limit' 769, 'weekly limit' 23, 'autocompact is thrashing' 8.

### 2.4 Frentes/trabalhos e lotes
1.149 trabalhos (130 frentes). Abertos: 6 (4 na_fila presos pela cota, 2 rodando sem turno vivo). Estado gravado = derivado em 100 %. 108 lotes: 3 abertos, 79 devolvidos ao colega com `peer_ask` (fecho OK). 117/117 frentes terminadas com resumo. 5 frentes falharam por queda em 12/10, nenhuma retomada sozinha. Rede de 2 min: 15 frentes, 6 viveram menos de 60 s.

### 2.5 Rotinas (01/10 → 15/10)
55 rotinas (18 ativas). 4.197 janelas em 14 dias; 75 % dos turnos de rotina terminam 'sem novidade'. Custo US$ 2.597 em 14 dias (f190bf45 sozinha US$ 754 em 1.048 turnos). 87 janelas bloqueadas por 'aguardando_resposta', 51 janelas interrompidas no despacho sem registro de execução. Logs de 14/10: 168 `rotina_janela_pulada` contra 64 disparadas. Zero duplicidade real em 14 dias.

### 2.6 Pedidos entre bots, esperas, decisões
1.001 handoffs; 72 sem resposta (25 nas últimas 24 h, todos com triagem pendente; 47 antigos de 05–09/10). 48 `esperar_comando`, todas acordaram. 198 `me_chame_as` → 192 voltas; 3 perdidas em reinício. 271 pendências (ferramentas desligadas desde 06/10). 1.148 decisões, 29 vencidas, 2 pendentes (perguntas do alarme de voltas). Zero procurações.

### 2.7 Contas, cota e máquinas
4 contas: Max (pos. 1, no limite até 16/10 13:00), ChatGPT Plus (pos. 2), Claude Team corporativa (pos. 3, livre), ChatGPT Pro (pos. 4, nunca usada). Modo 'perguntar', nenhuma na troca automática. `uso_do_plano` claude-cli: esgotado, semana 100 %. Máquinas vivas: VM 309ec3dd (último uso 08:07:10) e Mac f9c0837b (mesmo segundo). Inventário de motores não registra o Codex. 91 avisos `409 estado_invalido` em `/api/maquina/*` (reconexão esperada).

### 2.8 Eventos, outbox, incidentes
Outbox saudável (0 pendentes, 1 retentativa em 30 dias). ~36,7 mil eventos em 7 dias; sequência íntegra (0 duplos, 0 despacho após fim). Os "atrasos" grandes medem transações longas, não entrega. 32 incidentes mac_sem_contato, todos dispensados. Reinício limpo em 14/10 13:24. 2 `falha_interna` sem rota (15:22 e 15:30 de 14/10).

### 2.9 Consolidação dos achados
29 achados confirmados pelo cético (23 após fundir os que descrevem o mesmo mecanismo em varreduras diferentes), 14 plausíveis (autor com confiança alta, cético refutou como "desenho" ou por falta de prova), 5 refutados, 21 não verificados.

---

## 3. Os relatos de bug das pessoas

Agrupados por sintoma. "Corrigido" significa commit identificado no main; "aberto" significa que o mecanismo continua no HEAD.

**(A) Pedido a colega ou rotina sem resposta — 9 relatos (24/09 → 15/10).** Os 3 mais recentes (14–15/10) são exatamente a fila presa pela cota: o relato e3f3c0e3 aponta a tarefa 20f4696b (Clarice → Milton, 18:14 de 14/10) que nunca foi despachada. **Aberto.** Liga-se aos achados C1 (cota segura o fundo sem aviso), C4 (rotina re-delega), C7 (frente rodando sem turno vivo) e ao não-verificado "pedido absorvido pelo dono".

**(B) Bash/ferramenta negada — 7 relatos (01/10 → 12/10).** Desde 12/10 (commit 77dd5c10) a pílula mostra a causa (`espera_com_sleep`, `git_fora_da_pasta`, `sem_conferencia`). O motivo gravado no enum continua `alcance_insuficiente`, mas o cético mostrou que a causa real já está no evento (`dados->>'causa_nativa'`) e que o bot lê o motivo do hook, não o enum. **Corrigido no essencial**; sobra a métrica lendo a coluna errada (ver plausível P2).

**(C) Memória/histórico — 7 relatos (28/09 → 01/10).** Corrigido por 0030 (28/09), ADR-066 (01/10), NOD-185 (06/10) e NOD-206 (11/10). O resíduo das retomadas "sem lembrar" entre 01/10 e 11/10 é o achado C13 (rótulo `catcher` descartava a sessão). **Corrigido para turnos novos.**

**(D) Bot para no fim do turno com ações pendentes — 6 relatos (30/09 – 01/10).** Respondido por pendências (ADR-064), sessão viva (ADR-067), `me_chame_as` (ADR-086) e frentes (ADR-099). Sem reincidência nos relatos. **Corrigido.**

**(E) Rotinas: aprovar, alterar, "fazer agora" — 7 relatos (22/09 → 15/10).** NOD-182, NOD-197, NOD-159 e 0032 cobrem aprovação e edição. "Fazer agora" com turno aberto: o cético refutou como defeito do servidor (ver R1); o que falta é feedback na UI. A reclamação de 15/10 ("a rotina não rodou") é o achado C3/C6 (janelas puladas em silêncio pela cota). **Parcialmente aberto.**

**(F) Conexão a apps — 4 relatos (24/09 – 01/10).** `conector_indisponivel`/`timeout_transporte` continua (3 no log de 14/10). O cético refutou o retry como decisão registrada da ADR-009 (ver R2). Liga-se ao achado C17 (chamada ao conector dentro da transação).

**(G) Card do limite da IA — 2 relatos (08–09/10).** A tempestade de cards por turno foi contida pelo portão da cota em 12/10 para frentes com task; rotinas sem trabalho e conversas ainda geram 2 cards por execução (13/10) — ver plausível P3. O silêncio que o substituiu é o achado C1. **Trocou de forma.**

**(H) UI — 9 relatos.** Celular (ADR-094, 10/10) e tela da task (#188/#195, 08/10) corrigidos. Copiar listas, opções clicáveis, HTML inline, mensagem enorme após o card e limite de caracteres: sem commit identificado (ver não-verificado N3). **Aberto, sem mecanismo de servidor.**

**(I) VM: `gh` só funciona após restart — 1 relato.** Mecanismo não confirmado. **Lacuna.**

Dado de qualidade que afeta a leitura dos relatos: 16 relatos apontam turnos rotulados `catcher` que rodaram no Mac (achado C13), e 8 relatos que apontam a fala da pessoa ficaram sem turno (achado C12).

---

## 4. Achados confirmados, por área e severidade

Numeração C1…C23. Área entre colchetes. Onde duas varreduras chegaram ao mesmo mecanismo, os achados foram fundidos e isso está indicado.

### Crítico

#### C1. Servidor sem contato com as máquinas e laços de fundo parados desde 15/10 08:07 (ao vivo) [contas-cota-maquinas]
- **Severidade:** crítica. **Tipo:** risco operacional.
- **Evidência:** às 09:57, `maquina_tokens.ultimo_uso_em` da VM 309ec3dd e do Mac f9c0837b = 08:07:10 (60 ms de diferença; às 05:30 atualizavam a cada `puxar`). Último evento em `events`: 08:04:08. Turno 74a72899 (rotina codex) `despachando` com `lease_ate` 08:08:40, vencido há mais de 100 min e não varrido. 12 rotinas ativas com `proxima_execucao` no passado (primeira 08:10). Nenhum incidente aberto. O log disponível termina às 00:24 com `nod_encerrado` + `drenagem_concluida` e não há log de subida depois.
- **Mecanismo:** o varredor de lease (`src/adapters/fundo/varredor-lease.ts:12`, a cada 15 s) e o agendador (`src/adapters/fundo/scheduler-rotina.ts:12`, a cada 30 s) rodam no processo do servidor e não dependem dos clientes; um servidor vivo não deixaria um `despachando` vencido por 100 min nem rotinas vencidas desde 08:10. `boot.ts:308` emite `nod_encerrado` só no desligamento limpo. A carência de boot da NOD-214 só protege nos primeiros 90 s após subir. Causa raiz não encontrada no banco: processo travado, morto, ou deploy que não voltou.
- **Impacto:** nada é despachado, nenhuma rotina dispara, Parar/retomar não agem, o turno travado não vira incidente. A pessoa vê bots "na fila" sem explicação.
- **Correção:** imediata — conferir o processo no container (logs desde 08:00, laço de eventos, pool) e reiniciar; a retomada passa pela carência de lease e os turnos órfãos viram `reinicio_servidor`. Estrutural — heartbeat do servidor por tick (agendador/varredor) exposto na tela; alarme externo quando `ultimo_uso_em` de todas as máquinas vivas passar de 2–3 min; healthcheck do compose que olhe o heartbeat, para o Docker reiniciar processo travado e não só morto.
- **Conhecido:** NOD-214 (carência de boot) não cobre.

### Alta

#### C2. Cota do Claude medida na conta Max segura todo o fundo dos bots fixos há ~40 h: 38 turnos presos, conta Team livre ociosa, ninguém avisado [turnos · colegas · contas-cota-maquinas]
Funde os achados das varreduras "turnos-presos", "colegas" e "contas-cota-maquinas".
- **Severidade:** alta (autores: alta; céticos: alta no ângulo da conta, média nos outros dois).
- **Tipo:** risco de produto + lacuna de visibilidade.
- **Evidência:** 38 pendentes criados de 14/10 09:19 a 15/10 05:04, todos claude-cli/opus, `attempted=false`, `machine_id` null, agente vivo, alvo VM online: 27 delegações (Ze 1 ×19–20, Cartola ×3, Dev 1 ×4 incluindo as 3 frentes do lote dde087ce, Milton ×1), 9 rotinas, 1 frente aberta pela pessoa (a305c426, desde 10:56) + 1 retomada. `uso_do_plano` claude-cli: `esgotado`, semana 100 %, renova 16/10 13:00, medido 14/10 19:20. Conta Max abd13446 (pos. 1) `no_limite_ate` 16/10 13:00; conta Team 22f39160 (corporativa, pos. 3) `pronta` nas duas máquinas, `no_limite_ate` null, rodou 219 turnos / US$ 189,70 até 14/10 09:50 e parou de ser usada quando a Max entrou (09:54). Logs: `cota_segura claude-cli:reserva` desde 09:56:46 e `:limite` desde 19:20:30. Último despacho de fundo claude-cli: rotina 09:50, delegação 09:18. Bots 'auto' seguiram no Codex a noite inteira. Nenhuma linha de sistema diz que N pedidos estão represados; os 25 handoffs sem resposta não têm `peer_ask`. O cético reconferiu no banco a linha de `uso_do_plano`, as contas e os 38 pendentes.
- **Mecanismo:** o portão está dentro do `reivindicar` (`src/repositories/turnos.repo.ts:286-296`, ADR-099 §7): IA em 'limite' segura todo o fundo (trabalho_id, origem rotina/delegacao/peer, acordar_em). A cota é lida por harness (`src/domain/cota-da-ia.ts:38-64`, uma linha de `uso_do_plano` por IA); a conta não entra — `contas_ia.no_limite_ate` só pesa na escolha da conta (`emitir-plano-turno.ts:158`). Como o segurar acontece antes do despacho, o turno nunca passa por `semContaNaMaquina`/`criarNotaDeContas` (`despachar-turno.ts:144-174`), então não nasce nota nem botão "Seguir com". `uso_do_plano` só se renova num turno que termina (`assentar-turno.ts:253`, guarda `medido_em` mais novo em `uso-do-plano.repo.ts:22`); sem turno Claude rodando, a leitura velha fica. `pedir-a-bot.ts:130-155` devolve `instrucaoPedidoRecebido` (`triagem.ts:90-93`) sem consultar a cota, embora o item 8 da ADR-099 prometa dizer "espera por falta de recurso". `turno-orfao.ts:54-59` só observa o pendente velho (log `turno_velho_na_fila` 1×/h). A tela mostra a pílula de cota e "esperando a cota da IA" apenas em tasks (`trabalhos.ts:219-232`, `cota-da-ia.ts:142-146`); os turnos de triagem sem trabalho não aparecem. A Team é corporativa com `entra_na_troca_automatica=false` e o modo é 'perguntar' (ADR-101/102), então mesmo um portão por conta não a usaria sem clique da pessoa — isso é escolha dela, e é o ponto que o cético usou para rebaixar outros ângulos.
- **Impacto:** nenhuma rotina, pedido entre bots ou frente dos bots fixados em claude-cli roda de 14/10 ~09:30 a 16/10 13:00; quem pediu não sabe e repete o pedido (C4); na renovação, 27 triagens + 9 rotinas + 3 frentes disparam juntas e consomem a janela nova de uma vez.
- **Correção (melhor entre autor e cético):** (1) visibilidade, sem contornar limite — quando o `reivindicar` segura turno de IA fixa pela cota, criar uma vez por bot a nota/decisão "Claude · Max no limite até 16/10 13:00. Seguir com Claude · Team?" (reusa o "Seguir com" que a conversa já tem); linha na conversa de quem pediu ("o pedido espera a cota do Claude, volta ~13:00 de 16/10"); mostrar a delegação sem task como "na fila (cota)" em Trabalhos; mostrar a cota por conta na lista de contas (a pessoa pôs em 1º uma conta a 99 % da semana). (2) Em `pedir-a-bot.ts`, calcular `situacaoDoTurno` para o alvo e, se `cotaSegura('fundo_novo')`, dizer isso na instrução. (3) Decisão de produto do dono: se o portão deve ser consciente da conta (uma IA só segura se nenhuma conta elegível dela está livre) e se a conta corporativa pode absorver fundo; exige `uso_do_plano` por `conta_id` ou cruzamento com `contas_ia.no_limite_ate`. (4) Contorno imediato para a pessoa: pôr a Team em 1º e mandar uma fala a um bot Claude, para a leitura nova soltar o portão (inferência pelo código, não testada).
- **Conhecido:** ADR-099 §7, ADR-101/102 (cota por IA, troca de conta por consentimento), NOD-219 (observar o pendente velho).

#### C3. Harness congelado no turno: trocar a IA do bot não vale para o que já está na fila — rotina de 10 min da Clarice ficou ~23 h presa atrás de um turno Claude [rotinas · contas-cota-maquinas]
Funde os achados "turno de rotina carrega a IA copiada" (turnos-presos), "harness congelado" (rotinas) e "turno pendente herda a IA" (contas).
- **Severidade:** alta (céticos: alta, média e média). **Tipo:** bug.
- **Evidência:** turno dcdbf4af (rotina f190bf45, cron `*/10 * * * 1-5`, bot Clarice 83075133) criado 14/10 10:00:46 com harness claude-cli/opus; o bot recebeu `agente_atualizado inteligencia fixa codex-cli` às 10:12:59 e hoje é codex-cli/gpt-5.6-sol. O turno segue `pendente` (mesma `geracao_execucao`, sem máquina, sem task). Um "Executar agora" às 18:08 (a520907f) rodou no Codex e concluiu em 6 min sem destravar nada. Nos logs, dcdbf4af é o `turno_aberto_id` de 85 das 86 `rotina_janela_pulada` da f190bf45 (10:10 de 14/10 → 00:20 de 15/10). É o único dos 38 pendentes com harness diferente do agente (o cético reconferiu no banco). O bot Milton alternou codex↔claude às 10:20/10:34 e voltou ao Claude, então seus pendentes estão presos legitimamente.
- **Mecanismo:** `src/use-cases/disparar-rotina.ts:155-169` enfileira com `modelo: agente.modelo, harness: agente.harness` daquele instante (INSERT em `turnos.repo.ts:166-173`). O `reivindicar` julga cota e harness pronto por `t.harness`/`t.modelo` da linha (`turnos.repo.ts:233-234, 244-245, 294-296`) e nunca relê `agentes.harness`. `definirInteligenciaDoBot` (`src/use-cases/inteligencia.ts:28-47`) grava a nova IA e só zera a sessão do CLI da conversa — não toca turnos pendentes nem avança `geracao_execucao`, logo o NOD-219 (`turno-orfao.ts:55-56`, `turnos.repo.ts:653, 694`) não o vê como órfão. `turnoAberto` (`rotina-janelas.repo.ts:67-72`) conta pendente como execução aberta e `disparar-rotina.ts:122-129` pula a janela só reagendando; "Executar agora" (`preservarAgenda`) ignora a checagem, por isso passa.
- **Impacto:** a ação natural quando o Claude esgota (trocar a IA) não destrava a rotina; ela fica parada em silêncio e, quando sair, roda no Claude/opus em vez da IA escolhida. O mesmo vale para delegações pendentes de bots que mudarem de IA.
- **Correção:** (a) em `definirInteligenciaDoBot`, na mesma transação, reescrever `harness`/`modelo` (e limpar `conta_id`) dos turnos `pendente` do bot de origem rotina/delegacao/peer (a conversa fixada pela pessoa fica, pela ADR-036); o teste "sem requeue" só proíbe voltar a `pendente`, não alterar colunas. (b) Mais robusta: no `reivindicar` e no plano, para turno pendente de fundo, resolver a IA pelo agente atual (join em `agentes`). (c) Aviso ancorado na rotina quando N janelas seguidas são puladas por um turno pendente. Qualquer opção toca a regra de cota (ADR-099 §7) e pede validação do dono e teste de concorrência do `reivindicar`.
- **Conhecido:** ADR-099/ADR-102 não tratam a troca de IA com fila pendente.

#### C4. Frente que cai por infraestrutura nunca é retomada sozinha: `interromper` zera `lease_ate` e o varredor lê a criação do turno como a hora da queda (I9 da ADR-099 inoperante; mesmo defeito nos pedidos a colega) [frentes]
- **Severidade:** alta (mantida). **Tipo:** bug.
- **Evidência:** 4 frentes de lote falharam por queda em 12/10 (b7b4ede1 Dev 1, 257c5de9 Ze 1, 6cd25400 Ze 1, f37cf8f9 Dev 1): `turno_interrompido` (reinicio_servidor/maquina_sem_contato) e `decisao_decidida regra:frente_caiu` no mesmo segundo (11:14:57.118→.512; 15:05:07.463→08.219; 17:24:00.973→02.090). `quedas=1`, `retomadas=0`, card Retomar fechado por regra. `perdido_desde` dos eventos estava 1–2 min antes, mas os turnos haviam sido criados 2 h 10 a 3 h 47 antes. 0 de 767 turnos interrompidos desde 12/10 têm `lease_ate`. 59 retomadas automáticas da ADR-084 existem, nenhuma para frente. O dado não foi reconsultado pelo cético; o código foi.
- **Mecanismo:** `turnos.repo.ts:546-549` (`interromper` grava `lease_ate = null`, chamado por `interromper-por-maquina.ts:139`; o instante real da queda vai só para o evento, `:150`). `frentes.repo.ts:160, 164-165` e `trabalhos.repo.ts:470` calculam `queda_em = coalesce(u.lease_ate, u.criado_em)` → sempre a criação. `domain/pedido-parado.ts:92-96`: quedas<3, mas `agora − quedaEm` > 2 h (`RETOMAR_ATE_MS`, :93) ou > 30 min sem sinal (`DESISTIR_SEM_SINAL_MS`, :95) → desistir. `frentes-caidas.ts:21-33` fecha o card → `domain/trabalho.ts:124` 'falhou' → `fechar-lote.ts:27-46` → `responderAoColega` com motivo. Os testes (`tests/integration/frentes-caidas.test.ts:35-38`) só simulam frente recém-criada, nunca frente antiga que cai.
- **Impacto:** qualquer frente ou pedido a colega com mais de 30 min de vida quando o servidor ou a máquina cai é dada por perdida na hora; o colega recebe "falhou (reinício do servidor)" e o dono acorda para perguntar à pessoa. Com deploys frequentes (6 reinícios em 12/10) isso derruba frentes longas sistematicamente. Atenuante: o dono é avisado com o motivo, não é silêncio; a sessão do CLI ainda é propagada quando há credencial (`interromper-por-maquina.ts:130-134`).
- **Correção:** coluna `interrompido_em` gravada em `interromper` e `coalesce(u.interrompido_em, u.lease_ate, u.criado_em)` nos três pontos (opção mais segura; não zerar `lease_ate` pode quebrar quem depende de `lease_ate = null` nos terminais). Teste de integração: frente criada há 3 h cai por `reinicio_servidor`, máquina volta com turno concluído → deve retomar (tentativa 1 de 3). Mesmo teste para pedido a colega.
- **Conhecido:** nenhum.

#### C5. Laço de reenvio no limite sem teto: 682 turnos e 682 avisos em 32 min numa conversa (12/10 15:28–16:00); o caminho segue sem trava [turnos · contas-cota-maquinas]
Funde os dois achados sobre a tempestade de 12/10.
- **Severidade:** alta (autor: crítica; céticos: alta e média). **Tipo:** bug.
- **Evidência:** cadeia única de reenvios 1→682 (…aa07ba2e r=681, 848d54b4 r=682 concluído às 16:00:00), um a cada ~2,7 s, de 15:28:12 a 16:00:00; todos origem conversa, harness/modelo auto, bot 076566ff (posto em 'auto' às 15:27:51), conversa 0d431581, uma só `mensagem_origem_id`. 696 `turno_despachado` claude-cli/opus na VM, 681 diagnósticos 'session limit · resets 4pm', 682 `turno_interrompido` com `ia_no_limite=claude-cli`, 682 linhas de sistema `ia_trocada claude-cli→codex-cli`. O Codex estava `motor_ausente` na VM até 14/10 (7 turnos codex recusados em 12–13/10). Custo 0. Parou na renovação. Fora desse dia, máx. de reenvios = 4.
- **Mecanismo:** `assentar-turno.ts:297-321` marca a IA no limite e cai em `aposLimite` (:354, :412-457): com o bot em Automático, `proximaIaNoLimite` (`inteligencia.ts:83-85`) acha o Codex pronto em *alguma* máquina viva (`prontosDaPessoa`, `ponte-interna.ts:518`) e reenfileira a mesma fala com harness 'auto' e `reenvios+1`, sem `acordar_em` e sem teto. O alvo do bot é a VM (ADR-090): o `reivindicar` entrega ao alvo "mesmo sem a IA pronta" (`turnos.repo.ts:223-243`) e o plano escolhe a primeira IA pronta da máquina mesmo no limite (`iaDoAutomatico`, `inteligencia.ts:66-69`). O único teto existente é `reenvios >= 1` em `aposContaAusente` (:577); `aposLimite`, `aposTrocaDeConta` (:485-500) e `repetirNaConversa` (:590-609) não têm. O commit b1f80fb5 (NOD-211/ADR-101) tratou só o laço da troca de conta e está apenas em branches de frente. Hoje, com conta anunciada na máquina, `semContaNaMaquina` corta no 2º turno; máquina sem contas anunciadas ainda cai em `aposLimite`.
- **Impacto:** centenas de processos CLI e centenas de linhas na conversa em minutos, fila da pessoa monopolizada até a renovação. Volta sempre que a IA alternativa não estiver pronta na máquina-alvo do bot.
- **Correção:** teto de reenvios por `mensagem_origem_id` (1 ou 2) em `aposLimite`, `aposTrocaDeConta` e `repetirNaConversa`; em `aposLimite`, fixar o harness do turno novo na IA escolhida (ou a máquina que a tem pronta) em vez de 'auto'; no plano/despacho, com todas as IAs da máquina-alvo no limite, adiar com `acordar_em = renovaEm` em vez de rodar a "primeira pronta"; alarme para N turnos da mesma origem em < 5 min; teste de regressão "limite com a outra IA pronta só noutra máquina".
- **Conhecido:** NOD-211/ADR-101 (só a troca de conta); emenda ADR-036 de 10/10 ("o turno nunca fica preso") não cobre o ciclo.

#### C6. Frente "rodando" sem turno vivo (esperando colega preso na cota) pula a rotina 3ecfa179 a cada hora e deixa a execução das 11:00 sem desfecho [rotinas]
- **Severidade:** alta (mantida). **Tipo:** bug.
- **Evidência:** lote 60639abb aberto pelo turno 4c579c6f (janela 11:00 de 14/10, bot Leonardo): frentes d6677d79 e eec8344e terminadas 12:10/12:11; 5966689b e 11fddc51 em `rodando` (iniciadas 12:03/12:04) com 0 turnos vivos (últimos concluídos 12:12:10 e 12:40:33), 0 decisões abertas, 0 esperas, lote nunca devolvido. Handoffs dessas frentes → tarefas 4424eb84, 7ce39427, 6be044b3 para o bot Cartola (4cf78e3c), `pendente/delegacao/claude-cli` desde 12:07–12:34, nenhuma com `peer_ask`. 13 `rotina_janela_pulada` da 3ecfa179 com `trabalho_aberto_id=5966689b` (12:00 de 14/10 → 00:00 de 15/10). O cético reconferiu no banco o estado das frentes e das três delegações.
- **Mecanismo:** `domain/trabalho.ts:120` (aguardandoColega → 'rodando') com `trabalhos.repo.ts:333-340` (handoff com tarefaId sem `peer_ask` e colega não final); `filhaAbertaDaRotina` (`trabalhos.repo.ts:197-203`) só olha o estado, sem idade nem turno vivo → `disparar-rotina.ts:127-131` devolve `pulada` sem reivindicar janela; a execução das 11:00 não fecha por `disparar-rotina.ts:245-247` (`aguardando_frentes`). O varredor devolve 'esperar' sem prazo para colega na fila (`pedido-parado.ts:83-85`); as delegações são `fundo_novo` (`cota-da-ia.ts:84-85`) e estão seguradas (C2).
- **Impacto:** rotina horária parada desde 12:00 de 14/10 sem registro; cadeia rotina → frente → colega → cota sem aviso em lugar nenhum; a lista de trabalhos mostra 2 frentes "rodando" há 20 h sem nada rodando e sem ação além de Parar (frente de rotina não tem "Fazer aqui", `coordenar-trabalhos.ts:214`).
- **Correção:** (a) dar prazo à espera no varredor: colega `na_fila` há mais de N h avisa quem pediu ou devolve a frente como 'falhou/parada por cota', fechando o lote e acordando o dono; (b) em `filhaAbertaDaRotina`, ignorar frente sem turno vivo em espera de colega por mais de 1–2 períodos do cron, ou registrar a janela como 'pulada' com a causa; (c) na frente "rodando", mostrar "esperando Cartola · a cota da IA segura o pedido, volta 16/10 13:00". Contar o pedido de uma frente já iniciada como `fundo_seguindo` é decisão de produto.
- **Conhecido:** ADR-099 I7 revista (frente segura a rotina por desenho); a espera indefinida não está prevista.

### Média

#### C7. Rotina do Leonardo re-delega ao Ze 1 a cada execução enquanto os anteriores seguem na fila: 19–22 pedidos pendentes ao mesmo bot, 9 num só turno [colegas]
Funde os dois achados sobre pedido repetido.
- **Severidade:** média (mantida). **Tipo:** bug.
- **Evidência:** delegações pendentes Leonardo(076566ff)→Ze 1(72e4ae01): 19 com raiz na rotina cca275ad, de 10 turnos distintos, 14/10 10:02 → 15/10 05:04; o turno a6028245 (16:03) abriu 9 pedidos em 3 s. Em 30–36 h: 27 handoffs ao Ze 1 (8 voltaram) e 6 ao Cartola (3 pendentes). Leonardo é o maior remetente do tenant (139 de 1.001 handoffs) e tem 3 rotinas ativas (`0 * * * *`, `30 * * * *`, `*/30`). O dono do Ze 1 vê "19 pedidos na fila". Contagens não reconferidas pelo cético.
- **Mecanismo:** `pedir-a-bot.ts:93-99` só recusa `espera_circular` (`cicloDoPedido`, `triagem.ts:49-69`); não há guarda contra pedido ao mesmo alvo com handoff anterior sem `peer_ask`. `abertos()` (`pedidos-de-colega.repo.ts:31-45`) devolve só `{de, para}`, sem id nem horário. A rotina roda na conversa (turno sem trabalho), então `aguardandoColega` não a segura e `turnoAberto` (`rotina-janelas.repo.ts:67-86`) só segue retomadas do próprio turno — a delegação criada no alvo não conta. "Não repita esses pedidos" só vale dentro do fio (`entregar-resposta-peer.ts:116-123`); cada janela é um fio novo. `prazo_em` (24 h) só é observado.
- **Impacto:** quando a cota voltar, o Ze 1 executa 19 triagens em sequência, boa parte repetida (custo, ruído, respostas duplicadas); a fila do dono fica inflada. Depende do estado de cota para aparecer, mas repete sempre que o alvo ficar indisponível por qualquer motivo.
- **Correção:** estender `abertos()` com `tarefaId` e `criadoEm`; em `pedirABot`, dentro da trava, contar os abertos do par remetente→alvo e devolver `ok:true` com instrução explícita ("você já tem N pedidos abertos a X desde hh:mm; não peça de novo") e recusar `ja_pedido` só acima de um teto pequeno (3) ou texto quase igual (evita bloquear pedidos distintos legítimos); listar no prompt de rotina/retomada os pedidos ainda sem resposta; opcionalmente a rotina pula a janela quando há pedido aberto ao alvo. Bloquear, absorver ou expirar é decisão de negócio.
- **Conhecido:** nenhum.

#### C8. Cota segura rotinas por dias em silêncio: 9 rotinas presas desde 14/10 10:00, janelas seguintes puladas sem registro, e o turno velho vai rodar com carimbo de 2 dias [rotinas]
- **Severidade:** média (autor: crítica). **Tipo:** bug de visibilidade/teto sobre comportamento desenhado.
- **Evidência:** 9 turnos de rotina pendentes: 82accaad/f827a9fe, 971ecf9b/3a230a2b, 68406301/c8b06a9b, dcdbf4af/f190bf45 (10:00), 323485f0/992769d5 (10:30), a40d894e/5f6f9188 (11:00), 6a7196bc/af013875 (11:30), c38ae4d4/3c082e9a (12:00), e0ddad53/9cd1d259 (22:00). Logs: 168 `rotina_janela_pulada` (f190bf45 86, 3a230a2b 28, f827a9fe 14, c8b06a9b 9, 5f6f9188 6, af013875 6, 9cd1d259 4, 3c082e9a 2) contra 64 disparadas, cada uma apontando o mesmo `turno_aberto_id`. Nenhuma linha em `rotina_janelas`/`rotina_execucoes` dessas rotinas desde 14/10 10:00; `proxima_execucao` segue avançando na lista.
- **Mecanismo:** `cota-da-ia.ts:82-93` (rotina sem trabalho = `fundo_novo`; limite segura todo o fundo) aplicado em `turnos.repo.ts:286-296`. Enquanto o turno fica pendente, `disparar-rotina.ts:122-132` devolve `pulada`, reagenda e não registra execução nem evento; `scheduler-rotina.ts:49-53` só loga. `turno-orfao.ts:49-56` só observa. A entrada já foi montada com o `instanteAgendado` original (`disparar-rotina.ts:48-50`). Nenhum aviso de cota para rotinas em `src` nem em `web`.
- **Impacto:** 8 rotinas ativas (todas as de bots fixados em claude-cli) ficam ~51 h sem rodar, sem linha no chat, sem execução no histórico; ao renovar, 9 execuções de 2 dias atrás rodam de uma vez com instrução velha. Atenuante: a causa raiz é a assinatura esgotada e nenhuma correção faz a rotina rodar antes de 16/10 13:00. A ADR-045 define gatilho de revisão em 24 h seguidas de janelas puladas — o pendente de 14/10 10:00 cruzou esse limite às 10:00 de hoje.
- **Correção:** registrar a janela pulada no histórico com desfecho próprio (`adiada_por_cota`) e o turno que segura; mostrar na lista "aguardando a cota do Claude até 16/10 13:00"; para cron mais curto que a espera, encerrar o pendente como `interrompida` (motivo `cota_da_ia`) após 1 período do cron e deixar a janela nova nascer, ou re-carimbar o `instanteAgendado` ao sair da fila; aviso único por rotina após N puladas seguidas, ancorado na rotina. Deixar a rotina fixada em claude-cli seguir por outra IA livre é decisão do dono.
- **Conhecido:** ADR-099 §7 (portão), ADR-045 (pulada; gatilho de 24 h).

#### C9. Janelas de rotina interrompidas no despacho (`executor_indisponivel`) somem do histórico: 51 janelas em 14 dias sem execução nem evento; rotina sem conta morre em vez de esperar [rotinas · contas-cota-maquinas]
Funde os dois achados sobre recusa no despacho.
- **Severidade:** média (céticos: média e baixa). **Tipo:** bug.
- **Evidência:** janelas com turno interrompido `executor_indisponivel`: motor_ausente 25 (07/10 10:00 → 09/10 05:00), nao_autenticado 25 (02/10 → 08/10), limite_do_plano 1 (b1706cdb, turno 616c2680 codex, 14/10 13:00) — 0 `rotina_execucoes` e 0 `rotina_executou`. Para comparar: limite_do_plano no assentamento 38 janelas → 38 eventos; maquina_sem_contato 15 → 15; erro_execucao 19 → 19. b1706cdb tem 28 janelas e 26 eventos: faltam exatamente as 2 de executor_indisponivel. Log 14/10 13:00:11: `turno_sem_conta decisao=outra_ia` para 616c2680 (conta codex Plus no limite 12:40→13:40).
- **Mecanismo:** `despachar-turno.ts:144-174` (`semContaNaMaquina`) e `:177-193` (`recusarPorExecutor`) assentam `interrompido/executor_indisponivel`, emitem `turno_interrompido` e nota/negação na conversa, mas não chamam `registrarDesfechoRotina`, que só roda em `compor.ts:553-561` (entrega do CLI), `varredor-expiracao.ts:138` e `interromper-por-maquina.ts:44`. O turno de rotina nasce sem trabalho (`disparar-rotina.ts:150-170`), e `aposLimiteNoFundo` devolve null sem `trabalhoId` (`assentar-turno.ts:631-636`), então `esperarContaNaFrente` não se aplica e a rotina cai na interrupção, ao contrário da frente que espera a conta voltar.
- **Impacto:** a lista de execuções e a trilha `rotina_*` não veem essas janelas; a pessoa só vê uma nota solta no chat. Correção ao achado original: `janelasQueNaoRodaram` (`rotina-acessos.ts:114-121`) só conta 'bloqueada' por sem_acesso/sem_conexao, então o card de parada não seria alimentado por 'falhou'.
- **Correção:** helper que, dado o turno recusado de origem rotina/retomada, chame `registrarDesfechoRotina` com 'interrompida' ou 'falhou' e motivo, nos dois pontos, na mesma transação; para limite_do_plano, tratar a rotina como a frente (reenfileirar com `acordar_em` = volta da conta) em ponto novo, já que `aposLimiteNoFundo` exige task. Decidir se a mensagem 'rotina falhou' duplica a nota já existente (produto).
- **Conhecido:** nenhum.

#### C10. Pergunta das "voltas sem novidade" bloqueia a rotina por 24 h: 47 janelas bloqueadas na 9cd1d259 e 16 (e contando) na 57b9b36b [rotinas]
- **Severidade:** média (autor: alta). **Tipo:** bug de interação entre duas regras.
- **Evidência:** 9cd1d259 (Ada, `*/30 * * * 1-5`): decisão `pergunta` 7a85e952 criada 13/10 21:40:50 no turno 9da860a1 (retomada da rotina), prazo 24 h, vencida 14/10 21:40; 47 eventos `rotina_bloqueada/aguardando_resposta`; depois `passou_em_branco/pergunta_sem_resposta`, e a janela 22:00 virou e0ddad53 (preso pela cota). 57b9b36b (Leonardo, `30 * * * *` UTC): log 14/10 13:15:42 `voltas_sem_novidade` turno 54a9cb59 → decisão 4f191137 pendente (vista 13:31, prazo 15/10 13:15); 16 bloqueadas até 04:30. f697e3b3 teve 24 bloqueadas pelo mesmo motivo em 07 e 09/10. 3ecfa179 tem pergunta pendente e749ec80 (11:19).
- **Mecanismo:** `me-chame-as.ts:128-147` (ADR-099 §5): na 4ª volta sem novidade, decisão `pergunta` com `PRAZO_DECISAO_PADRAO_MS` 24 h (`autoria-evento.ts:16`). `pre-voo-rotina.ts:44-51, 70`: qualquer pergunta pendente de turno da rotina (tipo em `TIPOS_PEDIDO_A_PESSOA`, `pedido.ts:8`; a rotina é achada seguindo `retomaTurnoId`, `apoio-l7.ts:195-205`) bloqueia a janela com `aguardando_resposta`, por desenho da emenda ADR-044 ("o fio segura a janela", comentário `:55-60`). `disparar-rotina.ts:65-78` grava uma execução 'bloqueada' por janela, sem mensagem.
- **Impacto:** uma rotina de polling de 30 min fica 24 h sem rodar porque uma execução esperou 3 voltas; o histórico (20 guardadas) vira só 'bloqueada'; não gasta cota nem perde dado. A web já tem o rótulo "aguardando resposta" (`web/lib/execucao.ts:28-31`), não verificado na tela.
- **Correção:** o pré-voo ignorar a pergunta criada pela regra `voltas_sem_novidade` (a decisão já carrega `regra` e `decididoPor`), para a janela seguinte ser a "volta"; alternativa: prazo dessa pergunta = 1 período do cron. Mostrar na lista "parada: pergunta sem resposta desde X" com atalho ao balão. Validar com o dono se a pausa até a resposta é desejada.
- **Conhecido:** ADR-099 §5 × emenda ADR-044 — interação não prevista.

#### C11. Bot fixo no Codex com a conta em uso no limite: a nota promete "Seguindo com Claude", nada segue, e a conta Pro livre na mesma VM nunca é oferecida [contas-cota-maquinas]
- **Severidade:** média (autor: alta). **Tipo:** bug.
- **Evidência:** 14/10: 4 turnos de bots fixos em codex interrompidos no despacho com `executor_indisponivel + limite_do_plano`, evento `sem_conta=true` — 616c2680 (rotina b1706cdb 13:00) e aa551c05/2d2d179b/53db2897 (conversa da55bff6, 14:30:26/14:32:04/14:32:53); log `turno_sem_conta decisao=outra_ia` nos 4; as 4 notas têm `livres=0` e `de_ia=codex-cli`. A pessoa mandou 3 falas em 2,5 min, cada uma respondida só pela nota, e trocou a IA do bot às 14:32:50; só a 4ª fala (15:43, após a Plus renovar às 15:00) foi respondida. A conta Pro d0acfbfb estava `pronta` na VM desde 10:06 e tem 0 turnos até hoje. O cético confirmou no banco `contas_modo='perguntar'` e as posições das contas.
- **Mecanismo:** `despachar-turno.ts:155` passa só a IA fixa a `semContaParaOTurno`, mas `contas-do-turno.ts:72` chama `decidirLimiteDaConta` com `naMaquina` inteiro (contas Claude entram), `modo 'perguntar'`, `ordemDoBot: null`; em `contas-da-pessoa.ts:137-141` 'outra_ia' vem antes de 'perguntar' — a Max estava livre às 14:30 → decisão 'outra_ia', `livres` vazio (`contas-do-turno.ts:80`). O despacho (:165-173) só assenta e cria a nota; não recria turno para origem conversa. No assentamento o mesmo caso é tratado certo: `assentar-turno.ts:521-523` filtra `naMaquina` pela IA fixa. `contaEmUsoDaIa` (`contas-da-pessoa.ts:48-57`) fora do modo automático só considera a primeira conta da IA, por isso a Pro só apareceria como "Seguir com", que o bug impede.
- **Impacto:** bot fixo numa IA fica mudo até a conta renovar, com uma nota que promete uma troca que não acontece; a conta alternativa logada e livre nunca é usada; cada reenvio gera outro turno interrompido; a rotina das 13:00 foi perdida (C9).
- **Correção:** em `semContaParaOTurno`, com IA fixa, filtrar `naMaquina` pelas contas dessa IA (como `assentar-turno.ts:521-523`) e passar a ordem do bot, extraindo um helper comum aos dois caminhos; assim a decisão só pode ser 'perguntar' (com a Pro em `livres`) ou 'todas_no_limite'. Teste: bot fixo no Codex, Plus no limite, Claude livre, Pro livre → 'perguntar' com a Pro.
- **Conhecido:** nenhum.

#### C12. Relato que aponta a fala da pessoa perde o turno, os sinais e o diagnóstico — justamente nos "não fez o pedido" [relatos]
- **Severidade:** média (mantida). **Tipo:** bug.
- **Evidência:** 8 de 56 relatos com `turno_id` null (144c77af, 850e4105, 51c7599c, a1487887, 8167041a, 18c61745, 427d3f5e, f6ca5551), todos apontando mensagem de autor pessoa; 2 dos 4 `nao_fez_o_pedido` estão nesse grupo. Para 6 deles existe o turno disparado via `turnos.mensagem_origem_id` (986fe8a9, 76f11508, 6f731622, a77460b8, 6ee7ae74, e54a2e07). Contagens não reconferidas pelo cético.
- **Mecanismo:** `registrar-relato.ts:38-40` lê `mensagem.turnoId` (turno que produziu a fala; null para fala de pessoa) e `:51` grava `turnoId=null`; não consulta `turnos.buscarPorMensagemOrigem` (`turnos.repo.ts:179-184`), que já existe e é usado em `pedir-a-bot.ts:40-43`. O ADR-041 quer que o relato nunca chegue sem turno. Ressalva: `com_diagnostico` baixo (2 de 54) é esperado, porque `turno_diagnosticos` só existe para desfecho ≠ sucesso.
- **Impacto:** snapshot técnico (estado, sinais, harness, executor, custo, reenvios) vazio em 14 % dos relatos; na categoria mais útil a investigação começa sem turno.
- **Correção:** se `autor_tipo=pessoa` e `mensagem.turnoId` é null, resolver o turno por `buscarPorMensagemOrigem`, seguir `absorvido_por` até o absorvedor (`turnos.repo.ts:563-612`), usar esse turno para o snapshot; guardar mensagem apontada e turno disparado separados (coluna `turno_disparado_id` ou reuso documentado) e propagar ao evento `relato_criado` (`:90`) e ao listar.
- **Conhecido:** ADR-041 (objetivo contrariado).

#### C13. `turnos.executor` ficou no DEFAULT `'catcher'` em 2.179 turnos reais e, de 01/10 a 11/10, fez a retomada de rotina/pedido descartar a sessão do CLI [turnos]
- **Severidade:** média (autor: alta — o dano de comportamento já parou). **Tipo:** bug corrigido para frente + dado histórico errado.
- **Evidência:** coluna 'catcher' com plano 'local' em 2.179 turnos (16/09 → 11/10 09:56); 'local' com plano 'catcher' em 45. 16 relatos apontam turnos rotulados catcher que rodaram no Mac. Retomadas de cadeia com executor diferente do turno retomado que tinha sessão: semana 28/09 88 de 137; semana 05/10 246 de 597; semana 12/10 0 de 139. O dicionário conta 2.113 "claude-cli/catcher" que rodaram no Mac. 744 turnos de pedido de colega com catcher até 11/10 12:14, todos 'local' depois de 14:10.
- **Mecanismo:** `0002_dominio.sql:198` (`DEFAULT 'catcher'`); antes de 9c6c7ddc (NOD-206, 11/10 12:11) o INSERT gravava `t.executor ?? "catcher"` e nada escrevia o executor real. `emitir-plano-turno.ts:224-226` só dá `--resume` quando `daCadeia.executor === executor`; pai rotulado catcher + retomada local = sessão descartada e `historico` refeito (:239). `registrarExecutor` (:150-151) corrige para turnos novos. `enfileirar-retomada.ts:47` herdava o rótulo; `pedidos-parados.ts:42` ainda usa `executor: 'catcher'` fixo na autoria da retomada automática.
- **Impacto:** explica parte do cluster "não lembra o que fez" de 28/09–08/10 (interpretação; prova por relato não feita); contamina dicionário, gastos e Raio-X.
- **Correção:** backfill `update turnos t set executor = e.dados->>'executor'` a partir de `events turno_despachado` (ou `gastos.executor`), só onde divergir, valor restrito a ('local','catcher'), com contagem antes; `relatos.executor` passar a vir do turno; teste de conformidade `catcher ⇒ custo 0 e sessao_cli null`.
- **Conhecido:** NOD-206 (#240) corrige só daqui para frente.

#### C14. Custo do turno igual ao total da sessão depois de `--fork-session`: US$ 670 em 4 turnos de 08/10 [turnos]
- **Severidade:** média (autor: alta — só afeta exibição e métricas). **Tipo:** bug de cálculo.
- **Evidência:** conversa 47a05226, 08/10: 8530ff60 (10:44) custo = total = US$ 164,22 com 4.582 tokens de saída; db9655a0 (11:38) US$ 166,33; a40678bb (17:16) US$ 169,69; 823a850a (17:32) US$ 169,97. Em cada um `sessaoRetomada=true` e `sessao_cli` novo. O cético reconsultou: a sessão-mãe c25e95e7 chegou a 162,55 (5efd2071, 10:22); 8530ff60 abriu a sessão 3d8013ee em 164,22; o turno seguinte da mesma sessão (9d753610) deu custo 1,51 — a diferença correta. O cético contou 32 turnos com custo = total > US$ 5 desde 24/09, somando US$ 317,75; o autor contou 10 com `sessaoRetomada=true` somando US$ 708,55 (recortes diferentes, ambos a conferir). Dia 08/10: US$ 1.099 → US$ 429 sem os 4 outliers.
- **Mecanismo:** `claude-cli.ts:256-262, :311`: com bifurcar, `--resume <sessão> --fork-session` e o CLI escolhe id novo; `total_cost_usd` da cópia carrega o histórico da mãe. `assentar-turno.ts:233-234` → `totalAnteriorDaSessao` (`turnos.repo.ts:538-543`) busca `max(custo_sessao_usd)` pelo id novo → null → `custoDoTurno` (`custo-turno.ts:11-17`) devolve o total inteiro. A bifurcação nasce em `emitir-plano-turno.ts:230`.
- **Impacto:** custo por turno/bot/dia superestimado em até US$ 170 por turno bifurcado; "Hoje com" e custo por bot errados nos dias com rede promovida. Não bloqueia nada.
- **Correção:** gravar a sessão-mãe no turno (`sessao_origem_cli` = `plano.entrada.sessaoCli` quando bifurcou) e usar `max(custo_sessao_usd)` dela como "anterior"; recalcular os afetados pela diferença contra o maior total da conversa em outra sessão; regra de reversão da ADR-054 passar a olhar "custo = total com sessão retomada e sem anterior no mesmo id". Métrica financeira: validação humana.
- **Conhecido:** ADR-054 não previu a cópia de sessão (ADR-083, #193).

#### C15. A trava de fundo do Mac/VM bate no teto de 60 min em vez de aliviar: 76 trabalhos novos esperaram exatamente 1 h [turnos]
- **Severidade:** média (mantida). **Tipo:** gatilho de reversão da ADR-085 disparado (não é bug).
- **Evidência:** turnos sem `acordar_em` despachados 59–63 min após a criação: 49 rotinas e 27 delegações. Noite de 08→09/10 no Mac 90c92205: todo trabalho novo de fundo por 9 h esperou a hora cheia; VM: 10/10 22:10, 12/10 15:00, 14/10. Fila > 20 min: 168 rotinas e 90 delegações em 21 dias. VM em disco 'amarela' (5,9–6,2 GB livres) continuamente desde 13/10 13:24.
- **Mecanismo:** `turnos.repo.ts:266-275` (com `segurarFundo`, trabalho novo de rotina/colega espera enquanto `criado_em > agora − ESPERA_MAXIMA_FUNDO_MS`); `memoria-mac.ts:220-224` (`deveSegurar`: amarela segura em qualquer uso ≠ livre), `:231` (teto 60 min), `:238` (30 s entre começos); `:22-33` (no Linux, amarela abaixo de 20 % de MemAvailable); `:262` (disco alerta 10 GB absoluto, por desenho da ADR-096). O uso é por pessoa, não por máquina (`ponte-interna.ts:322-323`), então a VM herda o 'equilibrado' do Mac. A ADR-085:91 diz que `espera_ms` no teto mais de uma vez por semana em 'equilibrado' deve levar a rever os limiares.
- **Impacto:** +60 min fixos em rotinas e pedidos sempre que a máquina fica 'amarela' por mais de uma hora; na VM sem a pessoa usando, a trava não protege ninguém.
- **Correção:** na VM (linux), segurar só em 'vermelha' ou tratar o uso como 'livre' (uso por máquina, não por pessoa); medir `fundo_comecou` com `espera_ms` próximo do teto por máquina antes de mexer; ajustar o limiar de memória, não o teto; mostrar na rotina que ela espera a máquina e a hora em que o teto a libera. Sobre o disco da VM: investigar se a limpeza apertada da ADR-096 §3 roda e quanto libera (logs `limpeza_disco_apertado`/`limpeza_feita`); não mudar o limiar absoluto (alternativa descartada na ADR). Decisão do dono.
- **Conhecido:** ADR-085 (teto e gatilho), ADR-096 (disco), ADR-097.

#### C16. `turnoAberto` é O(janelas × turnos): o agendador fica 18–28 s numa transação a cada janela da rotina de 10 min [rotinas]
- **Severidade:** média (autor: alta). **Tipo:** bug de desempenho.
- **Evidência:** 134 `turno_criado` em 3 dias com entrega > 10 s, todos de rotina e sozinhos na transação. f190bf45 (1.423 janelas): atraso instante→turno_criado p50 27,4 s, máx. 82,6 s; tx aberta 18–28 s antes do INSERT (dcdbf4af: outbox 10:00:20, turno 10:00:46). O cético rodou `EXPLAIN ANALYZE`: com turno aberto para na 2ª janela em 25 ms; cada janela sem trabalho paga ~24 ms (Seq Scan em `turnos` 2× por CTE recursiva, 1.849 linhas lidas, 8.089 descartadas); sem turno aberto varre as 1.423 (≈34 s no pior caso). Sem índice em `turnos.retoma_turno_id`.
- **Mecanismo:** `rotina-janelas.repo.ts:67-87` (join de todas as `rotina_janelas` da rotina com turnos e CTE recursiva por janela sem trabalho); chamado em `disparar-rotina.ts:122-123` dentro da tx por rotina de `scheduler-rotina.ts:44-72`, evento só no fim (:69). Pool `max 5` (`db/client.ts:15`). `rotina_janelas` nunca é podada.
- **Impacto:** toda rotina começa 20–80 s depois do horário; custo cresce +144 janelas/dia × +500 turnos/dia. "Pool preso" e "commits tardios de outros eventos" são hipótese, não medição.
- **Correção:** índice parcial `turnos (tenant_id, retoma_turno_id) where origem = 'retomada'`; restringir às janelas recentes (`instante_agendado > now() − N dias` ou últimas K); podar `rotina_janelas`; log do tempo da tx do scheduler por rotina. Migração nova: validar com engenharia.
- **Conhecido:** ADR-045, ADR-099 I7.

#### C17. Chamada HTTP a conectores e execução de itens aprovados rodam dentro da transação do banco (commits de 15–54 s) [eventos]
- **Severidade:** média (autor: alta). **Tipo:** risco latente de concorrência + atraso visível.
- **Evidência:** negações `timeout_transporte` com tx aberta 15–17 s antes do evento (p95 16,7 s, máx. 37,7 s; 5d3081ad 15/10 08:03:53→08:04:08; gmail 7, linear 7, clickup 4). `resultado_aprovacao` decididas por regra com commit 19,9 s, 19,3 s e 53,8 s depois do evento (d2a63fc4, 18706e66, 68a23889, 14/10). Em 7 dias, eventos com commit > 5 s: mensagem_criada 161, trabalho_mudou 97, turno_despachado 51, turno_interrompido 49. Não reconferido pelo cético.
- **Mecanismo:** `executar-caso.ts:27-33` abre uma tx e roda o caso de uso inteiro nela; `chamar-ferramenta.ts:229` (`contaminar`, lock da linha do turno) e `:239-245` (`conectores.chamar` com orçamento 30 s, 3 tentativas, `constantes.ts:116-121`; negação gravada na mesma tx); `pedir-aprovacao.ts:145` (`executarItens` antes da mensagem em :169). O caminho da pessoa já faz certo: `decisoes.ts:134-141` executa fora da tx ("não segura conexão do banco"), princípio da ADR-001.
- **Impacto:** a web só vê a mensagem/negação ao commitar (até 54 s); conexões do pool presas até 30 s por chamada externa. Esgotamento do pool e bloqueio de `renovar` pelo lock não foram demonstrados.
- **Correção:** reaproveitar o padrão de `decisoes.ts`: em `pedir-aprovacao` automático, fase 1 (criar decisão/itens, commit) → `executarItens` fora → fase 2 (desfecho, fechar, mensagem, evento); em `chamar-ferramenta`, trilha + `contaminar` em tx curta → conector fora → desfecho em tx nova (rota `interno.ts` com dois `deps.dentro`). Medir duração de tx com alerta > 5 s antes de mexer no `max` do pool.
- **Conhecido:** ADR-001 (princípio), ADR-009.

#### C18. Aprovação automática gera retomada redundante no assentamento: 2º turno e 2º `rotina_executou` com o mesmo `execucaoId`, desfecho sobrescrito [rotinas]
- **Severidade:** média (mantida). **Tipo:** bug.
- **Evidência:** 112 turnos em 7 dias com dois `rotina_executou` (106 com o mesmo `execucaoId`). d58bbceb encerrado 15:33:43 → retomada 2d9edcf0 criada no mesmo segundo → 2º evento 15:34:27; 999a5b0c → a6028245 (26 s); 4d0ff927 → 38c0584e (41 s); 8e894b0a: 'executou' 05:04:39 e depois 'sem_novidade/ja_relatado' 05:05:27. Havia `resultado_aprovacao` por `regra:modo_total/modo_automatico` nesses turnos. Não reconferido pelo cético.
- **Mecanismo:** `pedir-aprovacao.ts:~118-190` (ramo automático executa os itens, `fecharPorRegra` — que não escreve `continuada_em`, `decisoes.repo.ts:~190-200` — e devolve 'decidida' sem `reivindicarContinuacao`); no assentamento `assentar-turno.ts:~393` → `continuarAprovacoesDoTurno` (`decidir.ts:186-199`) pega `aContinuarDoTurno` (`decisoes.repo.ts:168-173`: decidida e `continuada_em` null) e enfileira retomada (`enfileirar-retomada.ts:25-53`, sem dedup); a retomada chama `registrarDesfechoRotina` de novo ("uma linha por janela", `disparar-rotina.ts:~250-260`, `atualizarDesfecho` sobrescreve). O 0032 (`decidir.ts:~255`) corrigiu só o caminho da pessoa. A retomada é legítima quando há item executado no Mac (retorno 'pendente').
- **Impacto:** um turno extra (30–45 s de CLI, custo e cota) por aprovação automática; histórico pode virar 'sem novidade' depois de 'executou'; dois frames por janela.
- **Correção:** no ramo automático com todos os itens já com desfecho, chamar `reivindicarContinuacao(decisao.id, 'turno', agora)` após `fecharPorRegra`; manter o caso 'pendente' (Mac) sem reivindicar; em `registrarDesfechoRotina`, não rebaixar 'executou' para 'sem_novidade' na mesma janela nem reemitir o evento com o mesmo `execucaoId` se o desfecho não mudou. Testes para modo total e para o Mac.
- **Conhecido:** 0032 (`continuada_por`).

### Baixa

#### C19. Classificador de erro do fornecedor não reconhece os textos reais do limite do Claude nem o "autocompact is thrashing" [turnos]
- **Severidade:** baixa (autor: média). **Tipo:** rede de segurança incompleta.
- **Evidência:** 797 diagnósticos do Claude dizem 'session limit' (769), 'weekly limit' (23) ou 'monthly spend limit' (5); 0 casam com a regex de `limite_de_uso`. Antes da NOD-171 (05/10) 25 limites viraram `erro_execucao` e a fila seguiu despachando; depois, ~2 casos em ~773 sem `rate_limit`. 'autocompact is thrashing' 8 vezes (28/09–08/10).
- **Mecanismo:** `erro-fornecedor.ts:36-40` e `:41-46` não cobrem as frases do CLI 2.1.x; classe 'desconhecido' (:55-59) desliga o fallback de `ehLimite` (`assentar-turno.ts:297-298`). Mas no Claude o limite vem do protocolo (`stream-json.ts:366-371`, decisão da NOD-171: "pelo estado, nunca pelo texto"); os 695+76 'desconhecido' em `limite_do_plano` são inofensivos porque a frase e o prazo vêm do protocolo (`assentar-turno.ts:369-370`).
- **Impacto:** só no turno em que o `rate_limit` faltou (~0,3 %) a pessoa lê "erro de execução" sem hora e a IA não sai da ordem.
- **Correção:** acrescentar só `/(?:session|weekly) limit/i` e `/hit your \w+ limit/i`, com teste nas amostras reais redigidas; "monthly spend limit" como classe própria (teto da organização, frase para o admin, sem marcar a IA no limite com prazo inventado); "autocompact is thrashing" com frase própria ("comece uma conversa nova ou reduza o que o bot lê"), não '/compactar'. Investigar por que o `rate_limit` falta nesses ~0,3 % (`stream-json.ts:296-320`).
- **Conhecido:** NOD-171/NOD-174.

#### C20. 43 turnos terminam `trabalho_incompleto` sem motivo de falha nem diagnóstico: o CLI morreu sem `result` e a causa não é gravada [turnos]
- **Severidade:** baixa (autor: média). **Tipo:** lacuna de observabilidade.
- **Evidência:** 43 interrompidos com `motivo_falha` null (25 catcher até 11/10 12:11, 18 local), todos com `produced_output=true`, `erro_cru` null. Execução perdida p50 4 min, p90 33 min, máx. 80 min. Concentração 11/10 12h–13h (13; janela dos merges #247–#257 e de 20 `maquina_sem_contato`), 08/10 17h–18h (9), 09/10 (6). Não reconferido pelo cético.
- **Mecanismo:** `stream-json.ts:378` (sem `result`, com init/sinal/interrompidoPeloDriver → interrompido sem motivo); `assentar-turno.ts:124-126` (sem `parar_solicitado_em` e com output → `trabalho_incompleto`, `motivos.ts:37`); `laco.ts:231` (renovação devolveu `ativo=false` → `adapter.interromper()` sem registrar por quê; `ponte.ts:297-298` e `ponte-http.ts:184-187` são as fontes de `ativo:false`). O catcher fixa exitCode 143/0, signal null e stderr vazio (`catcher.ts:187, :296`), então para 25 dos 43 não há sinal nem stderr a gravar.
- **Impacto:** rótulo que não explica nada; impossível distinguir deploy, memória e bug do CLI no histórico. 0,4 % dos turnos; aviso na conversa existe; 41 de 43 entregaram fala parcial.
- **Correção:** `causa` fechada na entrega sem `result`, por driver (catcher: `renovacao_negada | interrompido_pelo_driver | reinicio_do_motor`; CLI local: `sinal:<SIG> | exit:<n>` + últimas linhas do stderr redigidas); log e evento em `laco.ts:231` com o motivo da renovação negada; no servidor, "renovar sem plano adotado" assentar como `reinicio_servidor` com causa.
- **Conhecido:** NOD-214 reduziu a causa 'reinício'; a lacuna de diagnóstico não.

#### C21. Frente de colega que pergunta à pessoa fica presa 24 h e, vencida a decisão, "termina" como concluída: o colega recebe a última fala como resposta, sem motivo [frentes]
- **Severidade:** baixa (autor: média — 2 casos em todo o histórico). **Tipo:** bug.
- **Evidência:** fa75c8a8 (Ze 1, lote 8316885e): `pergunta` criada 13/10 01:13, vencida (`expirou_com_alguem_ciente`), frente `terminado` 14/10 01:13:34 com 1.440 min entre o fim do último turno e `terminado_em`; lote devolvido com `peer_ask`. 7e50e4d6 (Eng 1, lote 83d5446d): `permissao` 13/10 00:41, vencida; terminado 14/10 00:42. São as 2 únicas decisões vencidas em frentes de lote (39 decisões).
- **Mecanismo:** `domain/trabalho.ts:119` (decisão pendente → precisa_de_voce) e `:122` (sem decisão, último turno concluído → terminado); `varredor-expiracao.ts:105-153` vence e chama `sincronizarDasDecisoes` (`trabalhos.ts:106-115`); `domain/frente.ts:136-143` `resumoSemChamada` para terminado devolve só a última fala (falhou/parado têm texto próprio); `retorno-do-lote.ts:92-98` só dá motivo para parado/falhou; `entregar-resposta-peer.ts:275-278, :95` (aviso de falha só para delegação e ignorado com lote aberto).
- **Impacto:** pergunta/permissão ignorada vira 'terminado' na tela e no retorno; o colega recebe como resultado a pergunta não respondida.
- **Correção:** ao vencer, gravar no resumo "pergunta ou permissão venceu sem resposta" e tratar como desfecho próprio (ou 'falhou' com motivo) em `resumoSemChamada`/`motivoDaFrente`, levando o motivo ao retorno do lote; não reutilizar `avisarFalhaDelegacao`. Escolher entre 'falhou' e desfecho novo é produto.
- **Conhecido:** revisão do épico S2 (decisão vencida deixa de segurar a task).

#### C22. Janela de 24 h do varredor e da espera circular conta do handoff, não do despacho: pedido que espera a cota sai da proteção antes de rodar [colegas]
- **Severidade:** baixa (autor: média — dano projetado, limite documentado). **Tipo:** risco.
- **Evidência:** o cético contou 24 delegações pendentes com handoff sem `peer_ask` nas últimas 48 h, todas `attempted=false`, `acordar_em` nulo; 27 delegações pendentes no total com `prazo_em` entre 15/10 09:19 e 16/10 05:04. A cota renova em 16/10 13:00, depois de todos os prazos.
- **Mecanismo:** `pedidos-parados.ts:15` e `pedir-a-bot.ts:51` (janela = `PRAZO_DECISAO_PADRAO_MS`, 24 h) aplicadas a `h.criado_em` (`trabalhos.repo.ts:499`, `pedidos-de-colega.repo.ts:34-40, 103`); `pedido-parado.ts` conta `RETOMAR_ATE_MS` a partir da queda, não do handoff, então o pedido seria retomado se entrasse na consulta.
- **Impacto:** depois da renovação, uma queda desses 27 pedidos fica muda (nem retomada nem aviso) e dois bots podem se pedir em círculo sem a trava. Ainda não aconteceu.
- **Correção:** ancorar a janela no primeiro despacho (`greatest(h.criado_em, min(turnos.attempted_em da cadeia))`) ou estendê-la enquanto a cadeia estiver pendente sem despacho. Alternativa: manter 24 h e aceitar o risco documentado. Decisão de produto.
- **Conhecido:** ADR-084 "Limites", ADR-099 item 8.

#### C23. Rótulo `executor='catcher'` em 2.335 turnos históricos contradiz o contrato do catcher ("sem CLI e sem custo") [turnos]
Complemento de C13 vindo das varreduras de desfecho e colegas; listado em separado porque a correção é de dados, não de comportamento.
- **Severidade:** baixa. **Tipo:** qualidade de dado.
- **Evidência:** 2.335 turnos com `executor='catcher'` (16/09 → 11/10 12:56): 2.179 com `turno_despachado` 'local', 1.755 com `sessao_cli`, 2.088 com `gastos` 'local'; só 129 têm `catcher_registros` (catcher real). 145 `rotina_janelas` com executor catcher até 09/10. 0 novos desde 11/10 12:56.
- **Mecanismo:** `contracts/evento.ts:5` e `catcher.ts:16-20` definem o catcher como driver de dev/CI; o rótulo veio do palpite `executor ?? 'catcher'` antes do `registrarExecutor` (`turnos.repo.ts:470`). O mecanismo exato da escolha do rótulo na fase do motor interno não foi localizado no HEAD.
- **Correção:** a mesma migração de C13, excluindo os 129 com `catcher_registros`; CHECK ou teste: catcher ⇒ `custo_usd = 0` e `sessao_cli` null.

---

## 5. Plausíveis (autor com confiança alta; cético refutou como desenho, duplicata ou falta de prova)

Em cada um, o que falta para virar achado.

- **P1. Pedido a colega e rotina presos em silêncio pela cota (ângulo dos relatos).** Refutado como "silêncio": a pílula de cota existe em `web/telas/trabalhos.ts:237` e `linha-do-dono.ts:227` (o autor procurou em `web/src`, que não existe). Sobra o que já está em C2: delegação sem task não aparece em Trabalhos e quem pediu não recebe linha. Falta: ler a UI para confirmar o que o dono dos bots Claude vê.
- **P2. Negação do Bash/Monitor gravada como `alcance_insuficiente` quando a causa é cerca do git ou sleep.** Refutado: a causa já vai no evento (`dados->>'causa_nativa'`, `assentar-turno.ts:257-266`), `terminal:false` é fixo nesse caminho e o bot lê o motivo do hook, não o enum. Falta: medir no dado se o bot para após a primeira negação (38 tentativas de sleep/Monitor em 3 dias) e agrupar métricas por `causa_nativa`.
- **P3. Tempestade de cards do limite "virou silêncio".** Refutado pela contagem do cético: depois de 12/10 nenhum card com task, mas rotinas sem trabalho e conversas ainda geram 2 cards por execução (13/10, conversa 0d431581, 6 pares a cada 30 min; 14/10, da55bff6, 3 em 2 min). Falta: entender por que o portão não segurou essas rotinas (cota nula? calculada só pela IA?) e unificar o card com o caminho `aposLimiteNoFundo`, que já tem linha com hora.
- **P4. Rotinas pulam janelas em silêncio enquanto o turno espera a cota.** Refutado em 01:30 porque o gatilho da ADR-045 (24 h seguidas de pulos) ainda não tinha sido atingido. Atingido às 10:00 de hoje — passa a valer como C8.
- **P5. Varredor de pedidos parados cego aos pedidos de triagem.** Refutado: `pedidos-parados.ts:91-92` também chama `triagensParadas`, que cobre handoff sem `trabalhoId`. O problema real é o pendente nunca despachado (C2/C6), e `fatos.colega` sem teto de tempo. Falta: saber por que cada pendente não é reivindicado (a métrica `turno_velho_na_fila` da NOD-219 deveria dizer).
- **P6. Cota semanal congela todo o fundo por ~51 h (ângulo dos desfechos).** Refutado como desenho (ADR-099 §7, ADR-101 §6 "Perguntar antes"); fallback para outra IA em bot fixo é decisão de negócio e jurídica. O que sobra está em C2.
- **P7. Fundo parado com conta Team ociosa e tela que não aponta a cota (ângulo das frentes).** Refutado como desenho pelos mesmos motivos; a lacuna de visibilidade está em C2 e C6. Falta: confirmar se a pergunta "Seguir com a conta N?" chegou a ser emitida por volta de 19:20 de 14/10 e ficou sem resposta.
- **P8. Após o Mac/servidor voltar, janelas de até 17 h atrás disparam e morrem por motor ausente.** Refutado: disparar a última janela velha é a regra de 2026-09-16 (`disparar-rotina.ts:110-113`), e a negação aparece na conversa. Sobra: o primeiro tick após boot não espera o inventário (`presenca.ts:36-42`), e o registro da execução está em C9. Falta: provar que os turnos de 08/10 08:52 nasceram antes do inventário ficar pronto.
- **P9. Fila longa antes do despacho (150 turnos > 30 min) e rotina "relata como se fosse 16:30".** Refutado: a mensagem "Rotina executou em" usa a hora real (`disparar-rotina.ts:279-281`); a rotina lê a fonte quando roda. Sobra: sem corte de idade para turno de rotina pendente. Falta: separar no banco cota de máquina fora como causa da espera.
- **P10. Polling 24×7 em UTC gasta a cota.** Refutado no mecanismo: os crons em UTC são de hora/meia hora, o fuso não muda janela nenhuma; o servidor não guarda o fuso da pessoa (ADR-007). Sobra uma proposta de produto: aviso ao criar rotina fora do expediente e pausa após N 'sem novidade'. Falta: medir quanto da semana as 7 rotinas consumiram.
- **P11. Triagem concluída que espera subpedido/lote nunca entrega.** Refutado como limite conhecido (ADR-063 "Não implementado", ADR-084 "pedido > 24 h fica de fora"); os 5 casos de 07/10 são anteriores à ADR-084. Sobra: `pedidosEmAberto` sem prazo. Falta: medir recorrência depois de 08/10.
- **P12. Disco da VM em alerta (~6 GB) segura frentes por 60 min.** Refutado: limiar absoluto de 10 GB é decisão da ADR-096 para uma VM de 49 GB. Sobra: a VM está estacionada em ~6 GB por dias — a limpeza apertada não está devolvendo espaço. Falta: logs `limpeza_disco_apertado`/`limpeza_feita`.
- **P13. Portão da cota por IA e não por conta (ângulo dos eventos).** Refutado porque a Team corporativa não marcada não seria elegível de qualquer modo (ADR-101/102). A parte de visibilidade está em C2.
- **P14. 409 `estado_invalido` em `/api/maquina/*`: uma máquina some a cada ~25 min.** Refutado: é reconexão desenhada (NOD-199); a rota `itens-locais` não renova `ultimo`, e um silêncio > 90 s com timer de 5 s só é compatível com o Mac suspenso. Falta: contagem de turnos `maquina_sem_contato` nessas máquinas nessas janelas; se houver com Mac acordado, avaliar `powerMonitor` no app.

---

## 6. Refutados

- **R1. "Fazer agora" e falas durante turno de rotina aberto não dão retorno** — a absorção de fala por turno de rotina foi corrigida em 07/10 (dc9b923d, ADR-083 §6); "executar agora" reivindica a janela do minuto, e não há janela às 19:10, logo o clique não chegou ao servidor (hipótese de UI, sem mecanismo).
- **R2. Conectores falham por `timeout_transporte` e o bot segue como se nada fosse** — não repetir timeout é decisão da ADR-009 e o orçamento de 30 s não comporta um retry de 15 s; o modelo recebe a negação; 58 timeouts em 4 semanas apontam lentidão do provedor.
- **R3. Task aberta pela pessoa e o recado dela esperam a cota como fundo** — é o que o código e a ADR-099 §7 definem ("task que nunca rodou, de qualquer origem"); a tela mostra "esperando a cota da IA"; só a conversa é isenta. Fica uma pergunta de produto.
- **R4. Codex: um `erro_execucao` marca a conta no limite por 1 h** — os dois turnos tinham "You've hit your usage limit" no erro cru, limite real; o classificador casa esse texto. Sobra uma melhoria: ler o "try again at" do texto em vez do prazo padrão de 1 h.
- **R5. Quedas do motor na VM em 11/10 coincidem com pressão de memória vermelha** — `pressao_memoria` não grava `machine_id`, a pressão só segura trabalho novo e não afeta o lease; dia de 125 commits e instalador manual do motor. Sobra: `machine_id` no evento de pressão.

---

## 6b. Não verificados (severidade baixa; pulados pelo cético para poupar cota)

Todos marcados como **não verificados**: evidência do autor, mecanismo não confirmado por segunda leitura.

- **N1.** Falas de negação/sistema não entram na sessão do CLI (o bot não "lembra" do que o Nod escreveu por ele) — relato 2cc6b32b; `emitir-plano-turno.ts:239-245` só injeta `desdeSuaUltimaVez` na sessão da conversa.
- **N2.** Pedido a colega "absorvido" pelo dono: resposta vai para a conversa do dono, não para quem pediu — relato a5d1121a, tarefa 20f4696b; `entregar-resposta-peer.ts:178-192` só sai pelo turno da própria delegação. 841816b3 concluída sem `peer_ask` sem mecanismo achado.
- **N3.** UI sem correção identificada: copiar listas (79854393), opções clicáveis (3cc49a45), HTML inline (30d8b402), mensagem enorme após o card (cd79ab44), limite de caracteres (210c321e).
- **N4.** NOD-219 não encerra nem explica o pendente velho: após `prazo_em` só loga `condicao_da_maquina`, sem distinguir cota — `turno-orfao.ts:51-60`; os 3 mais velhos cruzaram o prazo às 09:19 de hoje.
- **N5.** Rótulo `catcher` em 2.335 turnos: `sessaoDoTurno` (`turnos.repo.ts:485-488`) devolve executor errado e a retomada não faz `--resume` — complemento de C13/C23.
- **N6.** ADR-009: `produced_output` liga em qualquer `result` (até o de erro) e `rejected` nunca ligou (0/8.961) — `stream-json.ts:207-217`; 771 limites rotulados `trabalho_incompleto` com ~2,7 s de vida.
- **N7.** Deploys e quedas do servidor derrubam turnos em curso: 29 `reinicio_servidor` em 11–13/10 (0 desde NOD-214) e 17 h de `despachando` sem varredor em 07→08/10 (14 delegações interrompidas de uma vez às 08:51:59).
- **N8.** `executor='catcher'` em 2.113 turnos reais contradiz o contrato "sem CLI e sem custo" — mecanismo do rótulo na fase do motor interno não localizado.
- **N9.** Rede de 2 min promove frentes que acabam segundos depois: 6 de 15 viveram < 60 s, cada uma com lote, retomada de retorno (US$ 0,2–0,7) e linhas de sistema — `domain/trabalho.ts:186-189`; 13 sessões em 16 turnos de conversa do Milton em 14/10 (não confirmado que seja `largar_sessao`).
- **N10.** Frentes "rodando" sem turno vivo há 17 h sem caminho de ação na tela (5966689b, 11fddc51) — complemento de C6.
- **N11.** Recado à frente na fila vira "retomada" de um turno ainda pendente (c5aaefc6 retoma ef1aae1d): se o primeiro for recusado no despacho, a frente roda só com o recado — `coordenar-trabalhos.ts:63-73`.
- **N12.** "Executar agora" cria execução concorrente (3 casos) e `rotina_janelas.machine_id` é aleatório (`executar-rotina-agora.ts:19`, `randomUUID()`).
- **N13.** 47 pedidos antigos (05–09/10) sem resposta nem aviso; 16 com receptor excluído, 5 com receptor sem máquina; `pedidosEmAberto` sem janela segura entregas.
- **N14.** NOD-206 fechado no dado: 744 turnos de pedido de colega com catcher até 11/10 12:14; só UPDATE histórico opcional.
- **N15.** Pendências desligadas desde 06/10 (#174): 70 abertas congeladas, 29 de bots excluídos; 4 rotinas `so_com_pendencia` pausadas.
- **N16.** Alarme de 3 voltas vira pergunta que vence em 24 h e a espera morre em silêncio (7a85e952 vencida; e749ec80 e 4f191137 vencem hoje 11:19 e 13:15) — complemento de C10.
- **N17.** Volta marcada some quando o turno cai por `reinicio_servidor` (ad387407, 9860fe39, 3110987c) — `me-chame-as.ts:68-71` só cria a volta se concluiu; a retomada automática não herda `despertar_em`.
- **N18.** `inventario_motores` não reflete o Codex (só claude-cli 2.1.295 e catcher) embora 29 turnos codex tenham rodado na VM; anúncio por máquina fica só em memória.
- **N19.** `rotina_janelas.machine_id` é o id do processo do agendador (e31016a9 em 1.167 janelas), não a máquina — `scheduler-rotina.ts:47`.
- **N20.** Métrica de latência do outbox mede a transação, não a entrega (`events_outbox.criado_em = now()` do início da tx) — o despachante está saudável.
- **N21.** Janela pulada e fila presa são invisíveis: 168 pulos e 39 pendentes sem evento, card ou histórico — complemento de C8/C2.

---

## 7. Lista de ação operacional

Nada abaixo foi executado. Cada item diz o que, onde e por quê. Itens que mexem no banco devem ser feitos com o servidor de pé e, de preferência, pela ação equivalente na UI (Parar, responder), para o sistema gravar eventos e desfechos.

### Destravar hoje (banco/VM, com cautela)

1. **Servidor (C1), primeiro de tudo.** No host da VM: `docker logs` do container nod-nod-1 desde 08:00 BRT; conferir se o processo responde e se o laço de eventos/pool está vivo. Se travado, reiniciar. Ao subir, a carência da NOD-214 assenta o turno 74a72899 (`despachando`, lease 08:08:40) como `reinicio_servidor` e o agendador reagenda as 12 rotinas vencidas. Não mexer em `turnos` antes disso: com o servidor fora, nada do que for alterado ganha evento.

2. **Perguntas pendentes do bot Leonardo (C10, N16).** Responder na UI as decisões 4f191137 (rotina 57b9b36b, vence 13:15) e e749ec80 (rotina 3ecfa179, vence 11:19). Responder destrava a rotina na hora; deixar vencer registra `passou_em_branco` e a próxima janela nasce presa pela cota (C2).

3. **Turno dcdbf4af — rotina f190bf45 da Clarice (C3).** Opções, da menos invasiva para a mais: (a) "Parar" o turno pela UI, para a próxima janela de 10 min nascer já no Codex; (b) `update turnos set harness='codex-cli', modelo='gpt-5.6-sol', conta_id=null where id='dcdbf4af…' and estado='pendente'` — faz o turno sair da cota do Claude na próxima reivindicação, mas roda com a entrada carimbada em 14/10 10:00. Preferir (a).

4. **Os 19 pedidos Leonardo→Ze 1 (C7) e 3 Leonardo→Cartola.** Antes de 16/10 13:00, decidir se os pedidos duplicados devem sair da fila. Lista: os turnos `delegacao` pendentes com `agente_id` = Ze 1 (72e4ae01) e raiz na rotina cca275ad, em especial os 9 abertos pelo turno a6028245 às 16:03 de 14/10. Parar pela UI grava `peer_ask` de aviso ao Leonardo; `update` direto para `interrompido` não grava e deixa o handoff sem resposta para sempre. Se parar, parar os 3 ao Cartola (4424eb84, 7ce39427, 6be044b3) também encerra as frentes 5966689b/11fddc51 como 'falhou' e devolve o lote 60639abb — liberando a rotina 3ecfa179 (C6).

5. **As 9 rotinas presas (C8).** Turnos 82accaad, 971ecf9b, 68406301, dcdbf4af, 323485f0, a40d894e, 6a7196bc, c38ae4d4, e0ddad53. Se ficarem, rodam na renovação com instrução de 2 dias atrás, 9 de uma vez, consumindo a janela nova. Parar pela UI registra a execução como `interrompida` e a próxima janela do cron nasce limpa (presa pela cota até 13:00 de 16/10). Decisão do dono: vale mais a execução velha ou a janela fresca?

6. **Cota do Claude (C2).** Duas saídas sem código: esperar 16/10 13:00, ou pôr a conta Team (22f39160) em 1º e mandar uma fala a um bot Claude — a leitura nova de `uso_do_plano` da Team deve soltar o portão (inferência pelo código; não testada). Atenção: a Team é corporativa; usá-la para fundo é decisão da pessoa, e o modo 'perguntar' continua valendo. Não alterar `uso_do_plano` à mão: a guarda `medido_em` mais novo é a única proteção contra leitura velha.

7. **Frente da pessoa a305c426 (Milton, na_fila desde 10:56 de 14/10).** Tem "Fazer aqui" (origem pessoa). A pessoa pode trazê-la para a conversa se não quiser esperar a cota.

8. **Turno codex 0ce44c33 (rotina f7be2287), pendente há 1 h sem causa apurada.** Conferir após o servidor voltar; pode ser só o item 1.

9. **Saneamento único dos 47 handoffs antigos (N13, P11).** Gravar `peer_ask` de falha para os handoffs de 05–09/10 sem resposta com tarefa terminal ou receptor excluído, para parar de segurar `aguardando_colega` nas cadeias. Decisão do dono; listar antes com `select` por `payload->>'tarefaId'`.

### Precisa de código (ordem sugerida)

1. Heartbeat do servidor + alarme externo + healthcheck por heartbeat (C1).
2. Teto de reenvios em `aposLimite`/`aposTrocaDeConta`/`repetirNaConversa` e harness fixado no reenvio (C5) — pequeno e evita a próxima tempestade.
3. `interrompido_em` em `interromper` e `coalesce` nos três leitores (C4) — pequeno, destrava a retomada de frentes longas.
4. Troca de IA reescreve pendentes de fundo, ou `reivindicar` resolve a IA pelo agente (C3).
5. Visibilidade da cota: nota "Seguir com a conta N?" ao segurar turno de IA fixa, instrução de `pedir_a_bot` com a espera, delegação sem task em Trabalhos, janela pulada com desfecho `adiada_por_cota`, cota por conta na tela de contas (C2, C8, C6).
6. `semContaParaOTurno` filtrando pela IA fixa (C11) e `registrarDesfechoRotina` nos dois pontos de recusa do despacho (C9).
7. Pré-voo ignorar a pergunta das voltas (C10); guarda de pedido repetido por par (C7); prazo à espera por colega na fila (C6).
8. Índice em `retoma_turno_id` + limite de janelas em `turnoAberto` (C16); conector e `executarItens` fora da transação (C17); `reivindicarContinuacao` no ramo automático (C18).
9. Backfill de `executor` (C13/C23) e recálculo de custo bifurcado (C14) — migrações de dados, com contagem antes e validação humana no custo.
10. Relato resolve o turno disparado (C12); classes novas no classificador (C19); causa na entrega sem `result` (C20); desfecho próprio para decisão vencida em frente (C21); janela do varredor ancorada no despacho (C22).

Decisões de produto que o código não deve tomar sozinho: portão da cota por conta e uso da conta corporativa no fundo; fallback de IA em bot fixo; o que fazer com rotina presa além de um período do cron; pausa automática de rotina após N 'sem novidade'; religar pendências.

---

## 8. Lacunas

- **Causa raiz do servidor parado desde 08:07** não está no banco nem nos logs disponíveis (que terminam às 00:24). Precisa do host.
- **Recontagem no banco pelo cético** só foi feita em parte dos achados (C2, C3, C6, C11, C14, C16, C22, P3, P10). Nos demais, as contagens são do autor e o cético conferiu apenas o mecanismo no código.
- **UI não lida** em `web/` para a maioria dos achados de visibilidade (pílula de cota para o dono dos bots Claude, rótulo "aguardando resposta", tela da máquina com motivo 'disco').
- **Relação relato → mecanismo** no cluster memória (C13) é interpretação: não se provou, relato a relato, que a retomada perdeu a sessão.
- **Custo fantasma**: 10 turnos/US$ 708 (autor) contra 32/US$ 318 (cético) — recortes diferentes; precisa de uma consulta única antes do recálculo.
- **Logs do motor** não foram lidos (queda de 11/10, R5); `pressao_memoria` sem `machine_id` impede atribuir pressão à VM.
- **`inventario_motores` sem Codex** (N18) e **`rotina_janelas.machine_id`** sendo o id do agendador (N19) limitam qualquer análise por máquina das rotinas.
- **Cluster I dos relatos** (`gh` só após restart na VM) e **cluster H** (UI) sem mecanismo.
- **Por que o portão não segurou rotinas sem trabalho em 13/10** (P3: 2 cards por execução) não foi explicado.
- **Horários devolvidos pelo driver** em algumas consultas vieram com sufixo Z já convertidos para BRT; contagens são confiáveis, horários individuais citados de consultas do cético podem ter deslocamento de 3 h (anotado onde ocorreu).
- **Relatos 09–12/10 do cluster B** são da versão sem causa na pílula; não há relato novo depois de 12/10 para dizer se a pílula com causa resolveu a confusão.
