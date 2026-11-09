# oss/publico — arquivos que só existem no repositório público

Esta pasta guarda os arquivos de comunidade do repositório público do nod (ADA-287). O export de open source
(ADA-282) copia o conteúdo dela **por cima da raiz** do snapshot público, então `oss/publico/README.md` vira o
`README.md` de lá, `oss/publico/.github/...` vira o `.github/...`, e assim por diante. O README interno do
gamefik/nod não muda.

Este arquivo mora em `oss/`, fora de `oss/publico/`, porque o export copia `oss/publico/` inteira, sem lista de
exclusão: tudo o que estiver lá dentro vai para o público. Texto só interno fica aqui.

| Arquivo | No público |
|---|---|
| `README.md` | O que é, como instalar e como rodar local |
| `CONTRIBUTING.md` | Ambiente, regras do código, testes, PR e DCO |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 (resumo), denúncia em conduta@nodbot.ai |
| `SECURITY.md` | Relato privado (GitHub ou seguranca@nodbot.ai), prazos e escopo |
| `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md` | Templates de issue (bug, ideia) e de PR |

## A prova do README

`node scripts/oss/seguir-readme.mjs` segue a seção **Rodar local** do README ao pé da letra numa pasta limpa: monta
um repositório git a partir do commit atual com esta pasta por cima da raiz, roda `git clone` dele (no lugar da URL
pública), os blocos `passo=instalar`, `passo=banco-*` e `passo=subir`, e espera o `passo=conferir`
(`curl /api/saude`) responder. Os blocos são lidos do próprio README pela marca `passo=` na cerca de código, então
mudar o README muda o que o script roda. Detalhes e opções no cabeçalho do script.

O teste `tests/unit/oss/comunidade-publica.test.ts` guarda o contrato (os passos existem, na ordem, com `npm ci`,
`NOD_LOGIN=stub` e `/api/saude`; nenhum dado interno nos textos) e roda no `npm run test:unit`. A execução completa
fica em `tests/unit/oss/seguir-readme.test.ts`, ligada só com `NOD_SEGUIR_README=1`, porque faz `npm ci` e sobe o app.
