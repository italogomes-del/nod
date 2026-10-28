# ADR-135 — Registro único de ações e catraca de paridade tela × chat

Status: aceita · Data: 2026-10-28 · NOD-391 (projeto "Tudo pelo chat") · Emenda da ADR-082 (o risco do lote passa a sair
do registro; o excluir pelo Nod desliga o computador)

## Contexto

O projeto "Tudo pelo chat" quer que tudo o que a pessoa faz na tela possa ser pedido no chat. Hoje não há uma lista do
que a tela faz: as rotas de pessoa ficam espalhadas em ~30 arquivos (124 rotas que mudam algo), e o lote do Nod
(`gerir_bots`, ADR-082) tem o próprio enum e a própria tabela de risco. Sem lista, não dá para medir o que falta. E os
dois caminhos já divergiam: excluir um bot pela tela desligava o computador dele; pelo Nod, não.

## Decisão

1. **Registro único** em `src/domain/acoes/` (um arquivo por domínio, puro; os tipos em `src/contracts/acoes.ts`). Cada
   ação de pessoa que muda algo tem um id `dominio.verbo`, título, risco, se mostra cartão no chat, o estado no chat e,
   quando o chat já faz, o schema dos argumentos. `IdAcao` sai do registro: uma rota que declara um id fora dele não
   compila.
2. **Quatro estados no chat.** `vivo`: o chat faz pelo mesmo executor da tela, com teste de contrato. `parcial`: o chat faz,
   mas diverge ou falta parâmetro (o registro diz o quê). `falta`: a onda dona (NOD-393 a NOD-397, NOD-400) vai ligar.
   `nunca`: exceção escrita (senha, sessão, pareamento, credencial, o próprio chat, o cartão que é a resposta da pessoa,
   estado de tela, onboarding).
3. **Risco → modo de aprovação**: `leitura` nunca vira cartão; `muda` segue o modo do bot; `arriscada` vira cartão no
   manual e no automático; `pessoa_confirma` é sempre da pessoa, também em "Ignorar todas as aprovações". O lote deriva o
   risco de cada tipo do registro (`riscoDe` quando depende dos argumentos; `deFora` para a cerca 3 da ADR-082). O
   comportamento é o mesmo de antes: um teste compara o derivado com a regra antiga em toda combinação.
4. **Executor único e efeito pós-commit.** O piloto `bots.*` (criar, duplicar, editar, mover, excluir, mudar_modo) passa
   pela mesma função na rota e no lote (`src/use-cases/acoes/bots.ts`); o que cada caminho escolhe é parâmetro escrito
   (o lote cria já na seção, duplica com as rotinas pausadas e só confirma o modo total com o cartão aprovado pela
   pessoa). O modelo padrão do bot criado sem modelo (`NOD_MODELO`) vem dos `Deps`, igual nos dois caminhos. O efeito fora do banco vira `Deps.aposCommit`: roda depois do commit. Na rota, a falha sobe como antes; pelo
   Nod (e no clique do cartão do lote), a ação já commitou, então a falha vira aviso no log (`efeito_apos_commit_falhou`).
   O efeito agendado por uma ação do lote que o savepoint dela desfaz é descartado junto.
   **As duas diferenças tela × chat do piloto:** (a) *corrigida*: excluir pelo Nod agora desliga o computador do bot,
   como a tela; (b) *mantida e escrita*: duplicar pelo Nod cria a cópia com as rotinas pausadas (`rotinasPausadas: true`,
   o aviso volta ao Nod), enquanto a tela copia as rotinas no estado do original. O teste de contrato
   (`tests/integration/paridade-bots.test.ts`, um caso por id) fixa as duas; o desligamento no app composto está em
   `tests/concurrency/computadores-http.test.ts`.
5. **Catraca** (`tests/conformidade/paridade.test.ts`, sobre o app composto nos dois modos, com as famílias opcionais
   ligadas). A: toda rota de pessoa que muda algo (não GET, sem `interno`, `maquina` ou `publica`) declara `Rota.acao`.
   B: toda ação é usada por uma rota de pessoa, salvo `semRotaDePessoa` com o motivo (a conta mora em `/api/conta`). C: o
   número de vivas não cai abaixo de `docs/paridade.piso.json`, e o piso não cai em relação ao da `origin/main` (o CI
   busca a main antes); quem liga uma ação sobe o piso no mesmo PR. D: o
   `docs/paridade.md` é o gerado por `npm run paridade` (que sob CI só confere).

## Desvios registrados

- **Um PR só**, com os passos em commits (a regra do fluxo do Xumbrega), em vez de dois PRs empilhados.
- **O registro é lista de dados, não fábrica de rotas.** A rota continua escrita à mão e só declara o id; gerar rotas do
  registro mexeria em 124 handlers de uma vez, sem ganho para a medição.
- **`contas_ia.trocar_executor`** só existe no modo local (`POST /executor`); no compartilhado a rota não existe. A
  catraca compõe os dois modos, então a ação conta.
- **Parciais:** `rotinas.criar` (a tela manda fonte, limites e política sem dado; o lote preenche com padrões),
  `acessos.dar` (o lote só concede, sem o nível Nenhum nem revogar, e pela decisão do pedido de acesso) e
  `relatos.registrar` (a ferramenta do Nod e o botão gravam por casos de uso diferentes, sem teste de contrato). Viram
  vivas nas ondas donas.

- **`TIPOS_ACAO_LOTE` continua `as const` em `src/contracts/ferramentas-do-nod.ts`**: contracts não importa domain. Um
  teste de lista fechada amarra o enum aos `tipoNoLote` do registro; o risco (`riscoDaAcao`) já sai do registro.
- **A conta (`/api/conta`) fica fora da catraca A**: as rotas de conta são `publica` (sessão própria); os ids `conta.*`
  usam `semRotaDePessoa` com o motivo. Revisitar quando a conta ganhar caminho no chat.
- **"Vivo" não liga o handler ao executor por tipo**: o contrato de cada id é o teste de integração, não a catraca.
- **O efeito pós-commit pelo Nod roda antes de a ferramenta (ou o clique no cartão do lote) responder** (até 20
  desligamentos em série num lote).
  Aceito no piloto; se pesar, disparar depois da resposta, como a limpeza do NOD-374.

## Alternativas descartadas

- Anotar o id num comentário e medir por regex: não compila, e a rota nova passaria sem id.
- Lista à parte, fora do código (planilha ou issue): sai de sincronia no primeiro PR.

## Gatilho de reversão

Se a catraca barrar PRs sem relação com o chat mais de uma vez por semana (o id virando burocracia), trocar o A por um
aviso e manter só o C e o D.
