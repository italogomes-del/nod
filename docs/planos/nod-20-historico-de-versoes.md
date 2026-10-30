# NOD-20 · Histórico de versões do perfil com desfazer — plano de engenharia

Protótipo de referência: v5 aprovado (gamefik/nod-prototipos#18, commit c186a7e). Spec: issue NOD-20 e o comentário de
30/10 14:17 (padrões da v5). 1 PR: gamefik/nod#610.

## Arquitetura

- **Dados:** tabela própria `agente_perfil_versoes` (migração **0132**; a issue citava 0115, mas a 0130 e a 0131 foram para a main antes).
  Cópia inteira e redigida do perfil versionável (nome, subtítulo, missão, forma, cor, voz, velocidade), o número da
  versão, a origem (`inicial` | `tela` | `proposta` | `voz` | `restauracao`), `proposta_id`, `restaurada_de` e os
  `campos` que mudaram. Não vai na trilha (ADR-004: sem prosa); a trilha só recebe enum, uuid e número.
- **Gravação num ponto só:** `registrarVersaoDoPerfil(deps, {antes, depois, origem, ...})` em
  `src/use-cases/versoes-perfil.ts`, chamada pelos 3 caminhos de escrita depois do UPDATE, com a linha do agente já
  travada (o UPDATE trava; `editarPerfil` passa a usar `buscarParaAtualizar`). Ela compara `antes`×`depois` pelos campos
  versionáveis (domínio puro `src/domain/versoes-perfil.ts`); sem diferença não grava. Na primeira mudança grava antes a
  v1 `inicial` com o perfil de antes (sem backfill). Depois chama a poda e a trilha.
- **Restaurar:** `restaurarVersaoDoPerfil` trava o agente, lê a versão N, aplica nome/subtítulo/missão/forma/cor
  (`atualizarPerfil`) e voz (`definirVoz`), grava a versão nova `restauracao` com `restaurada_de = N` e recusa a
  proposta de perfil pendente do bot como obsoleta (mesma recusa da NOD-190: `TEXTO_PERFIL_MUDOU`). Restaurar a Atual
  (sem diferença) é recusado com `estado_invalido`. O texto com o marcador de redação («…») volta como está, e a tela avisa.

## Módulos

| Área | Arquivo |
| --- | --- |
| Migração | `src/db/migrations/0132_agente_perfil_versoes.sql` |
| Gate de RLS | `tests/conformidade/gate-rls.ts` (`POLICIES_EXTRAS` com o motivo da policy de poda) |
| Contrato | `src/contracts/versoes-perfil.ts` (VersaoPerfil, OrigemVersao, CampoVersionavel) |
| Domínio puro | `src/domain/versoes-perfil.ts` (camposQueMudaram, snapshot redigido, rótulos) |
| Repositório | `src/repositories/versoes-perfil.repo.ts` (inserir, listar paginado, buscar, ultima, podar, contar) |
| Casos de uso | `src/use-cases/versoes-perfil.ts` (registrar, listar, ver, restaurar) |
| Costuras | `editar-perfil.ts`, `confirmar-perfil.ts`, `ligacoes.ts` (definirVozDoAgente) |
| Ação | `src/domain/acoes/bots.ts` (`bots.restaurar_versao`), `src/use-cases/acoes/bots.ts`, `gerir-bots.ts` |
| Rotas | `src/adapters/http/rotas/agentes.ts` |
| Exportação | `src/repositories/minha-conta.repo.ts`, `src/domain/minha-conta.ts` (`perfil_versoes.json`) |
| Web | `web/telas/detalhes.ts` (linha Histórico, níveis `historico` e `versao`), `web/api.ts`, CSS `.p20-*` |

## Dados e migração (0132)

- `agente_perfil_versoes` via `nod_escopar_tabela` (RLS da dona + `nod_purga`), PK (tenant_id, id), UNIQUE
  (tenant_id, agente_id, versao), CHECK de origem e da coerência proposta_id/restaurada_de.
- `REVOKE UPDATE, DELETE, TRUNCATE ... FROM nod_app`: só acrescenta.
- FK (tenant_id, agente_id) → agentes ON DELETE CASCADE (molde de `maquinas_nuvem_eventos`, 0107). O produto só marca
  `excluido_em`; o CASCADE é a limpeza dos testes (limpeza-e2e e a varredura de sobras do fuzz apagam o agente).
- Poda das 50 últimas: função `nod_podar_versoes_perfil(agente)` SECURITY DEFINER, `search_path` fixo, `GRANT EXECUTE`
  a nod_app, presa ao tenant e à pessoa dos GUCs do escopo; policy `nod_poda_versoes` TO nod_dono só com os GUCs que a
  função liga e desliga. Entra em `POLICIES_EXTRAS` com o motivo.
- Rollback: DROP FUNCTION + DROP TABLE, testado ida e volta.

## APIs

- `GET /agentes/:id/perfil/versoes?antes=<versao>` → `{versoes: VersaoResumo[], total, atual}` (20 por página). Sem
  versões gravadas devolve a v1 virtual (o perfil de agora) para a lista não ficar vazia.
- `GET /agentes/:id/perfil/versoes/:versao` → `{versao, atual}` (os dois perfis, para o diff na tela).
- `POST /agentes/:id/perfil/versoes/:versao/restaurar` → `{agente, versao}`, `Rota.acao = "bots.restaurar_versao"`.
- Só a dona: bot de outra pessoa → `nao_permitido` (403) nas três; bot inexistente → 404.

## Ações

- `bots.restaurar_versao` — registro: `src/domain/acoes/bots.ts` (titulo "Restaurar uma versão do perfil de um bot",
  risco `muda`, cartaoNoChat não, schema {bot, versao}, casoDeUso `bots.restaurar_versao`, chat vivo via `gerir_bots`
  tipoNoLote `restaurar_versao`, `deFora: () => true` — muda a missão, então depois de conteúdo de fora vira cartão,
  como o `editar` da descrição)
  · rota: `Rota.acao` em `src/adapters/http/rotas/agentes.ts`
  · executor único: `restaurarVersaoDoPerfil` em `EXECUTORES_BOTS` (`src/use-cases/acoes/bots.ts`)
  · ferramenta: `gerir_bots` (só o Nod, em conversa e criação): `restaurar_versao` em `TIPOS_ACAO_LOTE`, campo `versao`
    no schema, validação em `validarLote`, `case` em `gerir-bots.ts`
  · cartão: no lote, sai do registro (`muda` segue o modo; `deFora` depois de conteúdo de fora)
  · contrato: `tests/integration/paridade-bots.test.ts` (tela e chat → mesmo perfil e mesma versão nova)
  · piso: `docs/paridade.piso.json` sobe 1; `npm run paridade`
- As rotas GET são leitura e não entram no registro.
- Suposição (sem seção "No chat" no spec): a ação nasce `vivo`, como manda a regra da ADR-135; o Nod restaura por
  número de versão ("volta a Ada para a versão 6").

## Bordas e erros

- Salvar sem mudança não grava (comparação campo a campo; inteligência fora).
- Duas gravações concorrentes no mesmo bot: serializadas pela trava da linha do agente; o UNIQUE é a segunda cerca.
- Restaurar versão podada/inexistente → `nao_encontrado`; restaurar igual a agora → `estado_invalido`.
- Restaurar com proposta pendente: a proposta sai `recusada` com `TEXTO_PERFIL_MUDOU` na conversa; o cartão já aberto,
  se confirmado depois, cai na revisão da NOD-190 (perfil mudou).
- Segredos: `redigirSegredos` em nome, subtítulo e missão antes do INSERT. O texto redigido volta redigido.
- Nod: só forma, cor e voz mudam (nome protegido, ADR-081); o Histórico do Nod segue as mesmas regras.
- Erros sem `message` vazada: `ErroDeDominio(codigo)`.

## Trilha

`kind = "perfil_versao"`, `ferramenta = "perfil"`, `regra = "perfil:versao"`, `regraVersao = número da versão`,
`motivo = origem`. Só enum, uuid e número; o CHECK `trilha_sem_texto_livre` continua passando (teste).

## Web (protótipo v5)

- Ajustes › Perfil: linha "Histórico · Cada mudança, e como voltar" com "N versões", só para a dona.
- Nível `historico`: intro, grupos por dia (Hoje/Ontem/data), linha "quem mudou o quê", "Versão N · hh:mm · campos",
  "Atual"; "Mostrando 20 de N. O nod guarda as 50 últimas versões de cada bot." + "Mostrar mais"; estados carregando
  (esqueleto), vazio e erro.
- Nível `versao`: "Versão N" no topo, título "X diferentes de agora", meta, orientação, um bloco por campo com
  "Nesta versão"/"Agora", voz numa linha, "N campos sem mudança" recolhido, "Ver o perfil completo desta versão",
  rodapé fixo com "Restaurar esta versão" (contorno; some na Atual), confirmação numa frase no mesmo rodapé, aviso de
  segredo redigido, erro "Não deu para restaurar. Nada mudou no perfil."
- Depois de restaurar: volta à lista com "Desfazer a restauração" (restaura a versão anterior) e role=status.
- Salvar pela tela é silencioso: depois de salvar missão ou nome, link "Desfazer a mudança na missão/no nome" (restaura
  a versão anterior); subtítulo sem Desfazer. Celular: alvos de 44 px.

## Testes

- Conformidade: gate de RLS; nod_app sem UPDATE/DELETE/TRUNCATE (has_table_privilege e tentativa real → 42501).
- Integração (`tests/integration/perfil-versoes.test.ts`): os 3 caminhos gravam; sem mudança não grava; proposta com
  proposta_id; redação de `sk-…`/`senha=…`; trilha só enum/uuid/número; restaurar = perfil igual + versão nova;
  restaurar com proposta pendente → obsoleta; outra pessoa recusada; 51 → 50; exportação inclui; purga apaga;
  rollback da 0132 ida e volta.
- Unit: domínio (diff, rótulos, agrupamento por dia), web (render dos níveis).
- Paridade: tela × chat de `bots.restaurar_versao`.

## Riscos

- SECURITY DEFINER e policy nova (superfície de acesso): presa ao escopo, revisada por /codex.
- Concorrência entre editar, confirmar proposta e restaurar: todas travam a linha do agente antes de gravar.
- Volume: 50 versões × perfil ≤ 8 KB por bot; índice por (tenant, agente, versao).

## ADR

Sem ADR nova: segue ADR-004 (trilha sem prosa), ADR-126 (exportação/purga), ADR-135 (paridade). A emenda é só o
registro desta tabela no gate de RLS.

## Passos (commits)

1. Migração 0132 + gate de RLS + teste de conformidade.
2. Contrato, domínio e repositório das versões + testes unit.
3. Gravação nos 3 caminhos + trilha + poda + testes de integração.
4. Restaurar + proposta obsoleta + rotas + ação `bots.restaurar_versao` (registro, lote, paridade, piso).
5. Exportação e purga.
6. Web: linha Histórico, lista, versão, confirmação, Desfazer e estados, com o CSS do protótipo.
7. Correções da revisão e do QA.

## Decisões tomadas na implementação (2026-10-30)

- Trilha: `ferramenta perfil`, `kind perfil_versao`, `regra perfil:versao:<origem>`, `regraVersao 1` (ADR-004: só enum).
- Não versionam: marcar como Nod, onboarding e a criação do bot (a v1 `inicial` nasce na primeira mudança, com o perfil
  de antes; sem nada gravado, a lista mostra uma v1 virtual com o perfil de agora).
- Missão e voz salvam num PATCH só (`descricao`, `voz`, `vozVelocidade`): uma versão, não duas. A rota `/voz` continua
  para a ligação (origem `voz`).
- Web: `versao` volta para `historico`, que volta para Ajustes. O Desfazer depois de salvar restaura a versão N-1 e fica
  embaixo do cartão Perfil; depois de restaurar, volta para a que era a atual e fica no topo do Histórico. Ele some quando
  a gaveta fecha. O total "N versões" aparece quando a lista chega (ela carrega ao abrir Ajustes ou Histórico, só da dona).
- Suposições: a versão inicial se chama "Criada por você"; o sublinhado do que é novo só no "Agora"; o nome salvo no topo da
  gaveta ganha Desfazer embaixo dele (protótipo v2); subtítulo, forma e cor não (ficam no Histórico). O Desfazer só
  restaura se a versão atual ainda é a que ele criou; senão some e manda para o Histórico.
