# ADR-007 — A fila global lê por PESSOA sob RLS, item vencido em cinza, servidor é fonte da verdade do tempo

**Status** mantido

## Decisão

Inalterado, e agora é a policy do ADR-003 e não uma segunda policy. A consulta de 'Sua vez' é leitura por PESSOA com a policy de duas pernas (dono OU decisor designado). Devolve pendentes e vencidos recentes com o estado como coluna; vencido em cinza com desfecho e botão de reabrir, nunca suprimido. Servidor envia instante absoluto em UTC; cliente só interpola. Os dois relógios (DECISÃO, tempo de parede; EXECUÇÃO, conta trabalho) continuam separados por nome de campo. O agrupamento muda de 'por empresa' para 'por pessoa e por agente' — é o critério de agrupamento de core/fila-frota.ts que muda, não a assinatura.

## O que mudou

Só o critério de agrupamento. A policy de duas pernas deixa de ser sobre tenant e passa a SER a policy de visibilidade do ADR-003.

## Por quê

Este ADR já se chamava 'lê por PESSOA' — estava certo por antecipação e a premissa nova só tirou o ruído de tenant que o cercava. Uma frente escreveu um ADR NOVO inteiro, com quatro alternativas rejeitadas, para chegar onde este ADR já estava. Era uma emenda de um parágrafo. E a alternativa 'consultar com role privilegiado e filtrar na aplicação' fica MAIS perigosa agora: a fila é a única tela onde o trabalho de 19 pessoas legitimamente se mistura, é a tela de abertura, e é onde um bug de filtro expõe conversa privada de colega.

## Refinamento (2026-09-16, 0003 e 0004 — a decisora decide, não apaga)

- A segunda perna ("decisor designado") é `decisor_id = current_setting('nod.pessoa_id')` na policy de `decisoes` (EMENDA 1) e um EXISTS na decisão em `itens_aprovacao`. Ela abre a LEITURA; para a decisora DECIDIR, a 0003 criou `nod_decisora` (PERMISSIVE FOR UPDATE, USING e WITH CHECK pela perna) com o trigger que fecha as colunas do ato de decidir — estado, desfecho, decidida_em, decidida_por, vista_em, e `prazo_decisao_em` só na transição vencida → reaberta (o botão "reabrir"). Em `itens_aprovacao`: selecionado, marcado_por, marcado_em, texto_final, editado_por.
- Com a 0004 (policies por comando), a decisora não apaga a decisão nem o item (DELETE é só da dona; antes o USING FOR ALL deixava). O que exige `owner_id` = pessoa — mensagem de resultado, turno de retomada, concessão — roda numa transação da DONA: a composição (`src/adapters/http/rotas/decisoes.ts`) separa a fase da decisora (marcar, fechar) da fase da dona (assentar, retomar), e a decisão diz quem é a dona (`ownerId`).
- `listarSuaVez` carimba `vista_em` ao listar (listar = ver): é o único sinal que separa `expirou_sem_ninguem_ver` de `expirou_com_alguem_ciente` (ADR-017 #2); consultas de fundo passam `marcarVista: false`.

