# ADR-002 — Classificação de dado pessoal por ORIGEM, função pura, default fechado

**Status** mantido

## Decisão

Inalterado. Classifica por procedência (conector, fonte, concessão), nunca por texto. Conector que não declarou: TOCA dado de aprendiz.

## O que mudou

Nada.

## Por quê

Este é o ADR que menos foi afetado pela mudança de premissa, e vale dizer por quê em voz alta porque várias revisões trataram 'dado de aprendiz' como se fosse um problema de multi-tenant. Não é. Os ~240 aprendizes da Patrícia são dados que a Leapy opera todo dia, internamente, hoje. O nod interno vai ler exatamente esses dados. A LGPD não pergunta quantas empresas usam o software.


## Refinamento (2026-09-16): a mensagem de erro é canal de vazamento

Inverte-se o default da Leapy (onde `message` do DomainError vai crua ao browser): no nod a mensagem de erro só sai para o cliente se for declarada segura. `ErroDeDominio` (`src/domain/erro.ts`) carrega um `codigo` de união fechada e o detalhe em `cause`; `src/adapters/http/erros.ts` traduz o código por uma tabela FIXA (status + texto em pt-BR) e qualquer outro `Error` vira 500 `{codigo:'falha_interna', correlation_id}` mais uma linha de log — nunca `err.message`. O log (`src/obs/log.ts`) também nunca ecoa o campo `texto`. Isto protege o CHECK do ADR-004: de nada adianta proibir prosa na trilha se a mesma prosa sai pela resposta HTTP. Prova: `tests/integration/erros-seguros.test.ts`.

## Gatilho de reversão

Reabrir se (a) um conector declarado `nao_toca` entregar dado de aprendiz — um incidente registrado basta: a classificação por ORIGEM teria falso-negativo, e a inspeção de conteúdo, hoje descartada, volta à mesa; (b) o default fechado ("não declarou = toca") deixar mais da metade dos conectores registrados sem declaração por 30 dias — sinal de que declarar custa demais e a classificação virou papel, não mecanismo; ou (c) a tabela fixa de `src/adapters/http/erros.ts` precisar de mensagem interpolada com dado do pedido para a pessoa entender o erro — aí o canal fechado está escondendo informação necessária, e a resposta é um mecanismo de mensagem segura por campo declarado, nunca voltar a expor `err.message`.
