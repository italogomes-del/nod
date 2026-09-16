# ADR-018 — Core puro guardado pelo compilador, PACOTE ÚNICO

**Status** revisado

## Decisão

O pacote único sobrevive sem emenda de princípio. A árvore ganha duas pastas: desktop/ (processo principal do Electron, preload, e o cliente que puxa trabalho) e executor/ (spawn da CLI, montagem de PATH, classificação de resultado — compartilhado entre os dois executores). O mecanismo não muda: tsconfig por alvo de build. desktop/ ganha tsconfig próprio com lib sem DOM e types node+electron. TRÊS FRONTEIRAS NOVAS guardadas pelo compilador: desktop/ importa contracts/ e executor/, e NUNCA db/ nem http/; executor/ não importa db/; web/ continua só importando type de contracts/. O esqueleto commitado antes da lógica permanece.

## O que mudou

Duas pastas, um tsconfig, três regras de fronteira.

## Por quê

A pergunta 'o pacote único sobrevive?' tem resposta verificada no repo de referência e é sim: o openmausbot TEM pnpm-workspace.yaml, lista só três packages, e electron/ não é um deles — é pasta do pacote raiz. O repo que tinha a ferramenta escolheu não usá-la para o app desktop. A regra 'desktop/ nunca importa db/' é a peça mais valiosa e a mais barata: transforma a sua decisão (o app não embute o servidor) de intenção em invariante do compilador. Sem ela a erosão tem nome no openmausbot: electron/main.mjs tem 2.647 linhas e uma bifurcação de boot onde, dependendo do modo, sobe um servidor embutido ou aponta para um remoto. Foi assim que um cliente fino virou dois harnesses para versionar e auditar.

