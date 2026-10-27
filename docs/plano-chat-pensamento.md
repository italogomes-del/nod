# Plano: o pensamento no chat (opção C)

Continuação do plano de 17/10 para deixar a conversa do nod mais perto do Rakazo e do Grok Bot. Vem depois do
[chat limpo](plano-chat-limpo.md) (ADR-114, Fases 3 e 4) e da fala viva (NOD-348, emenda da ADR-114). Responde a quatro
relatos de pessoas usando o produto, trazidos pelo Marlon em 26/10: a fala da pessoa demora a aparecer e o bot aparece
"pensando" antes dela; o bot escreve no balão e depois apaga; o indicador de pensamento é pequeno demais; as animações
não estão redondas.

Protótipo aprovado pelo Marlon em 26/10, **opção C**: https://claude.ai/artifact/6CevDm4XZuTfeP95qX7cjJ (privado). A
página toca os mesmos eventos do servidor em quatro painéis (Hoje, A, B, C), com dez cenários; cada cenário abre pelo
`#id` na URL (`#ferramentas`, `#curta`, `#rajada`, `#fala-no-meio`, `#pergunta`, `#aprovacao`, `#silencio`, `#frentes`,
`#longo`, `#fila`). A opção C usa o `nod-mascote` real (web/vendor/bloub empacotado) e serve de referência visual para
as capturas protótipo × app do PR.

**Um PR só** (decisão do Marlon, 26/10): as cinco partes abaixo entram juntas, num PR, com um commit por parte na ordem
de "Um PR, cinco commits". A revisão (/plan-eng-review, /review, /qa) roda uma vez, no fim, com as capturas de todos os
cenários do protótipo.

## A regra

1. **Enviar é instantâneo.** A fala da pessoa entra na tela no clique, com a chave de idempotência que já existe
   (`envios.iniciar`); o campo limpa no clique; o POST confirma e a releitura só reconcilia. Falhou: a fala fica, com
   borda tracejada e "Tentar de novo". Uma segunda fala durante o turno entra na hora, tracejada, com "Na fila ·
   Cancelar". A fala viva do bot nunca aparece antes da fala da pessoa que a provocou.
2. **O pensamento é o indicador principal.** No lugar da linha de 12 px ao lado do nome, um bloco abaixo do nome: o
   estado em 14 px com o brilho na cor do bot, e à direita a faixa `tempo · N ações · N falharam`. O detalhe (notas,
   ações, frentes, tarefas) começa **fechado**; a seta abre. Sem os três pontos: o movimento é o brilho e o mascote.
3. **Com o detalhe fechado, o cabeçalho mostra o pensamento atual.** A narração curta corre no cabeçalho, em uma linha
   com reticências; a ferramenta em uso entra com permanência mínima de 600 ms; sem nada, "Pensando".
4. **Balão só com texto definitivo, e balão nunca perde conteúdo.** A narração curta (≤ `NARRACAO_MAX_CHARS_WEB`, 280)
   mora no pensamento, nunca no balão. A promoção para balão de fala acontece ao passar de 280 caracteres (segue em
   streaming no balão), no `turno.fala` ou no fim do turno. Só anda numa direção. O servidor (`comporFala`) não muda.
5. **Nada some.** No fim, o bloco de pensamento vira a linha "Pensou por 9 s · 2 ações" acima da fala, no mesmo nó, e
   continua abrindo. Interrompido: "Parou depois de 1 min · 1 ação · você pediu". Narração que veio antes de uma
   ferramenta vira nota no histórico do pensamento. Falha de ferramenta fica marcada na lista e na faixa do cabeçalho.
6. **Turno longo.** Ferramenta repetida em sequência vira um grupo com ×N; só os 8 últimos grupos ficam à vista, os
   anteriores atrás de "N anteriores"; a faixa conta as ações a partir de 5.
7. **Um nó por fala.** Da fala otimista à gravada e da fala viva à gravada, a releitura atualiza; nunca recria.
8. **Movimento com permanência.** Estado troca no máximo a cada 600 ms (texto e mascote); entradas de 220 ms, uma vez
   por elemento; altura anima por `grid-template-rows`; sem animação de saída porque nada sai. "Reduzir movimento"
   desliga tudo, como hoje (web/lib/movimento.ts).

## O que o código mostrou (e muda o desenho)

Lido na main de 26/10 (762ce723a; bb4e0858 ao escrever este plano).

- **A fala da pessoa não é otimista.** `enviarComposer` (web/main.ts) faz o POST, espera a resposta, só então limpa o
  campo (`limparDepoisDeEnviar`) e despacha `invalidar conversa:id`; `reidratar` é serial e o GET da conversa inteira
  vem depois. O `turno.iniciado` chega por SSE junto da resposta do POST e a fala viva nasce do estado
  (`turnosVivos`) antes do GET. A resposta do POST já traz `ids.mensagem` e `ids.turno` (`RespostaMutacao`), o que
  basta para a fala otimista ganhar o id real sem esperar a releitura.
- **O balão que se apaga é desenho, não falha.** `falaComposta` (web/lib/atividade.ts) descarta a narração curta
  quando chega texto depois da ferramenta, espelhando `comporFala` do servidor (tests/unit/web/fala-paridade.test.ts
  trava a paridade). Além dela, `semTexto` zera o texto vivo no `turno.fala` e `semFerramentaAberta` no
  `principalOcioso`; os deltas atrasados do Mac recriam o balão.
- **O indicador é uma linha de 12 px.** `.fala-viva-linha.autor` (web/interface.css) ao lado do nome, com o brilho
  `fala-brilho`; sem balão até chegar texto. A pílula do topo diz "Pensando" em 12 px também.
- **As animações.** `fala-troca` roda a cada troca de estado (o anunciador do leitor de tela precisou de `ESTAVEL_MS`
  = 1 s; a tela não tem permanência); `fala-entra` reinicia quando `planoDoMorph` devolve null (mascote que aparece ou
  some, chave repetida); balões trocados de chave (`geracaoDoBalao`) saem sem animação; a fala viva vira a gravada por
  troca de nó, e o rodapé com `height: 25px; margin-bottom: -25px` existe só para esconder o pulo.
- **O mascote no chat usa dois estados.** `mascoteDaFala` (web/telas/conversa.ts): `idle` + `attentif` para pensando e
  escrevendo, `orbit` para ferramenta. Dos 15 estados do Bloub, a interface inteira usa 4 (`ESTADOS_BLOUB` em
  web/lib/mascote.ts); os outros 11 estão reservados em docs/mascotes.md.
- **O que já existe e é reaproveitado.** `envios.iniciar/concluir` e `corpoDoEnvio` (web/lib/envio-idempotente.ts);
  `falasSaindo` e `FALA_SAINDO_MS` (a fala que saiu até a releitura); `regiaoPorBlocos` + `planoDoMorph`
  (web/lib/morph.ts) para trocar só a parte que mudou; `renderResumoDasAcoes` com `linhasDoResumo` e `vezes` (×N);
  `data-disclosure` para o aberto/fechado sobreviver ao morph; `criarRelogioDaFala` para o tempo sem regravar;
  `cartao-pergunta.ts` e `cartao-revisor.ts`; `ACOES_GUARDADAS` = 2.000 e `ETAPAS_GUARDADAS` = 200 já limitam a memória.

## Parte 1 · Fala otimista

Só web. A fala da pessoa é um item provisório do reducer até o POST e a releitura confirmarem.

- Estado: `falasPendentes: Record<conversaId, FalaPendente[]>` com `{ idEnvio, texto, anexos, respondeA, em, estado:
  "enviando" | "falhou", mensagemId: string | null }`. Nasce em `enviarComposer` antes do POST; o campo limpa no clique
  (`limparDepoisDeEnviar` passa a rodar antes de `agir`); o rascunho (`rascunhos`) guarda o texto até o POST voltar, para
  um recarregamento no meio não perder a fala.
- POST ok: `mensagemId = ids.mensagem`. A releitura (`hidratar-conversa`) que traz esse id tira a pendente; a que não
  traz (saiu antes do POST) a mantém. `mensagem.nova` com o mesmo id também tira.
- POST falhou: `estado: "falhou"`; o balão fica com `border: 1px dashed var(--danger)` e a linha "Não foi enviada ·
  Tentar de novo"; Tentar de novo reusa a chave pendente de `envios` (mesma assinatura → mesmo idEnvio, o servidor
  devolve a gravada se ela chegou). Sem faixa de erro no topo para esse caso (regra já combinada: o aviso fica no elemento
  afetado, não numa faixa).
- Ordem na tela: a pendente entra no `timeline-historico` (que já vem antes do `timeline-ao-vivo`), com a chave
  `pendente:<idEnvio>`; quando a gravada chega, `blocosDoHistorico` usa a mesma chave para o id (`mensagemId` ↔
  `idEnvio`), e `regiaoPorBlocos` mantém o nó. A fala viva do bot (`turno.iniciado`) continua na região ao vivo, abaixo.
- Segunda fala durante o turno: a mesma pendente, com `na_fila` quando a conversa tem turno vivo; a linha "Na fila ·
  Cancelar" reaproveita `fila-na_fila` e o cancelar com 5 s de desfazer (`CANCELAR_DESFAZER_MS`).
- Anexos: a pendente mostra os chips já prontos (`anexosPendentes`) e espera o upload como hoje; a fala só sai com
  todos em `pronto`.
- Testes: reducer (`falasPendentes` nasce, confirma por id, some na releitura certa, falha e volta), render (chave
  igual entre pendente e gravada, ordem antes da fala viva), envio-idempotente (Tentar de novo reusa a chave).

## Parte 2 · O pensamento no lugar da linha viva

O coração da opção C. Só web; o servidor e os frames não mudam.

- `renderFalaViva` passa a montar o bloco `.pensar` entre o nome e o balão, com partes do morph: `pensar-cab` (estado +
  faixa), `pensar-corpo` (notas, ações, frentes, tarefas). `.fala-viva-linha` sai. O balão só entra com texto
  definitivo (regra 4): `falaComposta` ganha um irmão, `pensamentoDaFala(a)`, que devolve `{ cabecalho, notas[],
  grupos[], promovido: boolean, textoDoBalao }`; a promoção é derivada do estado (`atual.length > 280`, ou fim do turno,
  ou `turno.fala`) e, por ser só uma direção, cabe num campo `promovidoEm` na `AtividadeTurno` (o reducer marca uma
  vez; nunca desmarca).
- Notas: no `comFerramenta`, a narração que vira etapa (`etapas[].texto`) é o que já existe; o render lista as etapas
  como notas, na ordem, entre os grupos de ações.
- Grupos ×N e teto: `linhasDoResumo` já agrupa com `vezes`; o render mostra os 8 últimos grupos e um
  `<button>` "N anteriores" (`data-disclosure="acoes-mais-<turnoId>"`) que abre o resto.
- Permanência de 600 ms do cabeçalho: como o render é puro e regravado por frame, a permanência vive no DOM, em
  web/lib/fala-viva.ts, ao lado do relógio: `escreverEstado(raiz, agora)` lê `data-estado-fala` e
  `data-estado-desde` da parte e só troca o texto visível quando passaram 600 ms da última troca (a última vence). O
  mesmo relógio de 1 s (`criarRelogioDaFala`) ganha um tick de 200 ms só enquanto há troca pendente.
- Aberto/fechado: fechado por padrão; `data-disclosure="pensar-<turnoId>"` guarda a escolha da pessoa pelo morph e pela
  troca viva → gravada. No fim (`saindo` e gravada), o cabeçalho vira "Pensou por N s · N ações[ · N falharam]" com a
  mesma parte, e o corpo continua abrindo. A fala gravada precisa do mesmo bloco: `payload.acoes_do_turno` já guarda as
  ações; o tempo do turno entra no payload (`duracaoMs`, servidor, campo novo e opcional) ou fica só na viva (decisão 2).
- Interrompido: "Parou depois de N · N ações · você pediu" (ou "· o servidor caiu", pelo motivo do
  `turno.interrompido`), e a fala parcial, se houver, promovida com `parcial`.
- Esperando aprovação ou pergunta no meio do turno: o cabeçalho diz "Esperando sua aprovação" / "Esperando sua
  resposta", sem brilho; o cartão (que hoje chega pela releitura) fica logo abaixo do bloco.
- Silêncio do vigia: o aviso âmbar (`renderAvisoDoVigia`) passa a morar no cabeçalho ("Sem novidade há N min", em
  `--warning`, com o Parar ao lado); o corpo mantém a explicação.
- CSS: `.pensar`, `.pensar-cab`, `.pensar-estado` (14 px, o brilho), `.pensar-meta` (faixa; o separador é do CSS;
  vazio some), `.pensar-corpo` com `grid-template-rows: 0fr/1fr`. O rodapé negativo de 25 px sai. Tokens só.
- Testes: fala-viva (promoção numa direção só, notas, grupos, teto, faixa), morph-da-fala (as partes novas, o
  disclosure sobrevive), baloes-na-conversa (sem balão antes da promoção; promoção no meio do streaming mantém a chave),
  fala-paridade (o texto do balão continua igual ao de `comporFala`), acoes-da-fala (falhas na faixa e na lista),
  conversa-depois (a gravada com "Pensou por").
- Capturas protótipo × app antes do merge, como no #389: todos os dez cenários do protótipo (`#ferramentas`, `#curta`,
  `#rajada`, `#fala-no-meio`, `#pergunta`, `#aprovacao`, `#silencio`, `#frentes`, `#longo`, `#fila`).

## Parte 3 · Cor do bot no brilho e os estados do mascote

- O brilho: `background-image: linear-gradient(90deg, var(--ink-2) 0 28%, var(--mascote-cor) 44%, color-mix(in srgb,
  var(--mascote-cor) 55%, var(--ink)) 50%, var(--mascote-cor) 56%, var(--ink-2) 72% 100%)`, 320% de largura, 2,4 s,
  `cubic-bezier(.45,0,.55,1)`. Sempre `background-image`, nunca o atalho `background` (ele zera o `background-clip:
  text`; foi o bug do protótipo). A cor vem da classe `c-*` do bot (`--mascote-cor`, web/estilos.css). Contraste: testar
  as 12 skins nos dois temas; o creme e o âmbar sobre fundo claro são os piores, e podem precisar de
  `color-mix(... var(--ink))` maior só para eles. Esta é uma exceção declarada à regra do design system ("a cor do
  agente só no avatar, no ponto de trabalhando e na menção"): entra como emenda da ADR-070.
- O mascote no chat, pelo catálogo (docs/mascotes.md ganha a coluna "chat"):

  | Situação no chat | Bloub | Hoje |
  | --- | --- | --- |
  | disponível, na fila | `idle` | igual |
  | turno começou e nada chegou; entre ferramentas | `thinking` | `idle` + `attentif` |
  | narração ou fala em streaming | `idle` + `attentif` | igual |
  | ferramenta em uso, frentes trabalhando | `orbit` | igual |
  | frentes saindo (disparo único, 2,5 s) | `comet` | nada |
  | esperando aprovação ou resposta no turno | `notify` | nada (só "Sua vez" sem turno) |
  | silêncio do vigia | `alert` | `idle` |
  | a fala entra (disparo único, 1,7 s) | `wink` | nada |
  | depois de Aprovar / Retomar (disparo único, 2,1 s) | `play` | nada |
  | interrompido | `idle` | igual |

  A base contínua troca com a mesma permanência de 600 ms do cabeçalho; o disparo único toca por cima e volta à base
  no fim; outro disparo durante um disparo espera. `thinking` no chat não conflita com a NOD-216 ("só o turno rodando
  anima"): ele só aparece com turno rodando; a fila continua `idle`. Expressões: só neutra e atenta (regra da doc).
- Fora do chat, com fato tipado já existente e fora deste plano: `egg` (bot criado), `hexagon` (cartão de acesso ao
  conector), `burst` (task entregue, uma vez por entrega), `exclaim` (máquina caiu, limite do plano, falha). Continuam
  reservados `sleep`, `wide`, `swirl`.
- Testes: mascote.test.ts (o mapa e a permanência), mascote-bloub.test.ts (os estados novos existem no catálogo),
  cores-por-token (o gradiente só com tokens).

## Parte 4 · Cartões nascem do frame

Hoje `decisao.nova` só invalida; o cartão da pergunta e o do revisor chegam uma viagem depois. O frame passa a levar
o DTO da decisão (`SuaVezItemDto` ou o subconjunto que o cartão desenha), e o reducer insere o item provisório em
`suaVez` e na conversa até a releitura. Mesma chave entre provisório e gravado. Servidor: `outbox.repo.ts` e
`evento-stream.ts` (campo novo, opcional; cliente antigo ignora). É a única parte que mexe no servidor.

## Parte 5 · Animações

- `fala-troca` sai (a permanência já evita o pisca). `fala-entra` roda uma vez por bloco: `planoDoMorph` deixa de
  devolver null quando o mascote aparece ou some (o `<nod-mascote>` passa a existir sempre no bloco da fala, com
  `hidden` quando não há bot) e quando uma chave se repete (dedup pela ordem).
- Balões: com a promoção numa direção só, a chave do balão nunca muda; `geracaoDoBalao` sai junto com a narração no
  balão. `balao-entra` fica só para o balão novo (parágrafo novo).
- Viva → gravada: a mesma chave (`vivo:<turnoId>` → o id da fala final via `turnoId` + `fimDoTurno`), as mesmas partes,
  só os atributos mudam. O `.saindo` e o `FALA_SAINDO_MS` continuam como rede de segurança para a releitura lenta.
- `grid-template-rows` para abrir e fechar o corpo; `prefers-reduced-motion` zera tudo (já existe a regra geral).

## O que a execução mudou (26/10)

- A **Parte 5 entrou junto com a Parte 2**: sem `fala-troca` (a permanência faz o papel), sem o rodapé de −25 px, o
  pensamento é `data-no-lugar` e o `open` do `<details>` é da pessoa. A viva vira a gravada por regiões diferentes
  (`timeline-ao-vivo` → `timeline-historico`), então o nó é outro, mas com o mesmo HTML e sem animação de entrada na
  gravada: nada se mexe. O mascote que aparece ou some continua recriando o bloco (`planoDoMorph` null): caso raro
  (a frota carregando), ficou como estava.
- A **Parte 4 cobre a pergunta**: `decisao_criada` leva a fala de `pedido_a_pessoa` em `mensagem_json` (`DadosEvento`
  só aceita valores chatos) e a web a insere na conversa carregada até a releitura. O cartão de aprovação do revisor
  continua chegando pela releitura de "Sua vez": o DTO dele é montado na leitura (itens, prazos), e levá-lo no frame é
  outro trabalho.
- O **`play` depois de Aprovar** ficou de fora: o frame `decisao.decidida` não diz o turno; entra quando disser.

## Um PR, cinco commits

Branch `feat/chat-pensamento`, um commit por parte, nesta ordem (cada um deixa a suíte verde para a revisão ler por
commit):

1. Parte 4, cartões do frame: é a única mudança de servidor, pequena e independente; vai primeiro para o resto da
   branch já nascer com os cartões na hora.
2. Parte 1, fala otimista.
3. Parte 2, o pensamento: o maior commit; o teste de paridade e o de morph são a rede.
4. Parte 5, animações: depende da Parte 2 (as partes do morph e as chaves dos balões).
5. Parte 3, cor do bot no brilho e os estados do mascote: por último, porque é a parte visual que mais pode mudar nas
   capturas.

A revisão roda uma vez no fim: /plan-eng-review sobre este plano antes de começar, /review e /qa sobre o PR com as
capturas dos dez cenários. O diff é grande (web/telas/conversa.ts, web/estado/reducer.ts, web/lib/atividade.ts,
web/lib/fala-viva.ts, web/lib/morph.ts, web/lib/mascote.ts, web/interface.css, mais o frame no servidor): o commit por
parte existe para a revisão ler em cinco pedaços, e o rollback é do PR inteiro.

## ADRs

- **ADR nova (129): o pensamento no chat.** Emenda da ADR-114 e da NOD-348: o indicador principal, a regra da promoção
  numa direção só, o detalhe fechado por padrão, a permanência de 600 ms, a fala otimista. Gatilho de reversão: se em
  30 dias a taxa de abertura do detalhe for próxima de zero E os relatos de "balão que some" continuarem (a promoção
  não resolveu), volta-se a discutir narração como fala.
- **Emenda da ADR-070 (design system):** a cor do agente também marca o pensamento ao vivo (o brilho). Gatilho: skin
  sem contraste nos dois temas sem solução por `color-mix`.
- **docs/mascotes.md:** o mapa do chat (Parte 3) e os quatro de fora do chat ligados a fatos tipados.

## Riscos

- **Um PR grande.** Cinco partes num diff só: a revisão fica mais longa e o rollback é tudo ou nada. Mitigação: um
  commit por parte, suíte verde em cada um, e as capturas dos dez cenários antes do merge.
- **Paridade com o servidor.** O balão da viva precisa continuar igual ao `comporFala` (relatórios longos + final). A
  promoção aos 280 caracteres é exatamente a fronteira de `NARRACAO_MAX_CHARS_WEB`; o teste de paridade cobre.
- **Morph.** O bloco ganha partes novas; o risco é o `planoDoMorph` devolver null e recriar o nó (a entrada reinicia).
  O teste de morph passa a cobrir cada transição do protótipo (pensando → ferramenta → nota → promoção → fim).
- **Turnos longos no Mac.** Os deltas atrasados que chegam depois do `turno.fala` hoje recriam o balão; com a promoção
  marcada no estado, eles caem no segmento certo (o `turnoId` + o `promovidoEm`).
- **A pendente que nunca confirma.** POST que some sem resposta: a pendente fica "enviando" até o `envios` liberar
  (timeout do `pedir`), e vira "falhou". A releitura que trouxer a gravada com o mesmo idEnvio a tira mesmo assim.
- **Cor do bot no brilho.** Contraste das 12 skins; a exceção ao design system precisa da emenda, não de uma regra
  escondida no CSS (o teste `cores-por-token` continua valendo).

## Decisões tomadas (Marlon, 26/10)

1. Opção C: detalhe fechado por padrão, sem os três pontos, brilho na cor do bot, pensamento atual no cabeçalho.
2. Narração curta é pensamento, não fala: o servidor (`comporFala`) não muda.
3. Faixa do cabeçalho na ordem tempo · ações · falhas, à direita, com separadores do CSS.
4. Mascote: uma base contínua com permanência e disparos únicos por cima; os estados do Bloub entram pelo catálogo.
5. Outros personagens ficam para depois; o Bloub continua.
6. Um PR só, com as cinco partes (não cinco PRs).
7. As quatro decisões da seção seguinte, pelas recomendações.

## Decisões fechadas em 26/10 (o Marlon seguiu as recomendações)

1. **Limiar da promoção: 280 caracteres** (= `NARRACAO_MAX_CHARS_WEB`, a fronteira do servidor), numa constante só,
   `PROMOCAO_CHARS`. A resposta curta entra inteira no fim do turno; revisar com o uso.
2. **A fala gravada mostra o tempo.** O servidor grava `duracaoMs` no payload `acoes_do_turno` (campo novo, opcional,
   sem migração); a linha "Pensou por N s · N ações" fica igual ao vivo e no histórico.
3. **Fala no meio do turno: um bloco na tela.** O banco continua gravando uma mensagem por `turno.fala`; a web agrupa
   as falas do mesmo `turnoId` num bloco do bot (nome uma vez, os trechos de pensamento entre as falas).
4. **Mascote no silêncio: decidir nas capturas da Parte 3**, com `alert` e repouso + `somnolent` lado a lado.

## Fora deste plano

Outros personagens (o processo de medição do Bloub está no repositório upstream, docs/measurements.md); a queda do Mac e o
"posso retomar?"; limite do plano e troca de IA; anexos na fala viva; a sala com vários bots (a fala viva por bot já
existe; o pensamento entra igual, sem regra nova); não lidos e rolagem.

## Revisão de engenharia (27/10)

Revisão da implementação, não do desenho: a branch `feat/chat-pensamento` (PR #534, ec85f1b1, cinco commits sobre a `main`
de 26/10) lida contra este plano, a ADR-129, as emendas da ADR-070 e de docs/mascotes.md, e os pontos de contato que a
execução apontou (reducer, morph, releitura, `assentar-turno.ts`, `pedir-a-pessoa.ts`). Sessão autônoma: as decisões
abaixo seguiram "Decisões tomadas" e "Decisões fechadas em 26/10" e o menor risco; sem voz de fora nesta rodada (Codex
não instalado). O que era pequeno e seguro virou código e teste nesta mesma branch; o resto está registrado. Linha de
base antes das mudanças: 185 arquivos / 2.511 testes do `unit` da web verdes, `tsc` da web e do servidor limpos.

### O que virou mudança (código, nesta revisão)

1. **[P1] A corrida releitura × POST duplicava a fala da pessoa.** O `turno.iniciado` chega por SSE junto da resposta do
   POST e invalida a conversa; se o GET volta antes da resposta, a releitura traz a gravada enquanto a pendente ainda não
   tem `mensagemId` (`hidratar-conversa` só tira a pendente por id), e a confirmação do POST gravava `enviadas[m1] = e1`:
   o bloco da gravada trocava de chave para `pendente:e1`, igual à da pendente, e o nó era refeito. Mudou
   (`reducer.ts`, `fala-pendente-confirmada`): a confirmação cuja gravada já está na conversa só tira a pendente, sem
   `enviadas`. Teste em `fala-pendente.test.ts`. Resta a janela da resposta do POST com as duas à vista (risco aceito).
2. **[P1] A permanência atrasava até 1,6 s.** `criarRelogioDaFala` agendava o próximo tick a 1 000 ms; o plano pedia um
   tick de 200 ms enquanto houver troca pendente (entre ferramentas sem frame, a troca do cabeçalho esperava até 1 s além
   dos 600 ms). Mudou (`fala-viva.ts`, `TICK_CURTO_MS` = 200; `main.ts` pede o tick curto enquanto `escreverEstados`
   disser que alguma espera). Teste em `pensamento.test.ts`.
3. **[P2] `reenviarPendente` lia `r.ids.mensagem` sem guarda.** No deploy com o servidor de antes (sem `ids`), a fala
   enviada viraria "falhou" pelo TypeError no `catch`, e "Tentar de novo" a mandaria de novo. Mudou: `idsDaResposta`
   (perguntas.ts) exportada e usada nos dois caminhos; teste em `envio-idempotente.test.ts`.
4. **[P2] O motivo do erro sumia.** Antes, `agir` levava a frase da tabela à faixa (limite do plano, conversa encerrada,
   sem internet); o `catch` novo engolia tudo e a fala dizia só "Não foi enviada.", sem o que fazer. Mudou: `motivo` na
   `FalaPendente` e na ação `fala-pendente-falhou`, com a mesma frase de `erroDaAcao`, escrita na própria fala (a regra
   do aviso no elemento afetado, sem faixa). Teste em `fala-pendente.test.ts`.
5. **[P2] `mensagemDoFrame` aceitava mensagem sem `autoria`**, e `renderMensagem` lê `autoria.autor_tipo`: uma pergunta
   fora da forma derrubaria o render da conversa inteira. Mudou: a forma exige `autoria.autor_tipo`; teste em
   `pensamento.test.ts`.
6. **[P2] A paridade com o servidor não cobria o que a tela mostra.** `fala-paridade.test.ts` compara `comporFalaWeb` e
   `textoDaFala` com `comporFala`, mas a fala parada (e o balão da viva no fim) passou a vir de `falaNoBalao(a, true)`.
   Mudou: o teste compara `falaNoBalao(a, true)` com `falaComposta` (texto e trechos, as chaves dos balões) em nove
   atividades, inclusive o último bloco fechado por ferramenta e o limiar 280/281; e `PROMOCAO_CHARS` = `NARRACAO_MAX_CHARS`.
7. **[P2] O catálogo do Bloub contradizia o chat.** `mascote-catalogo.ts` marcava `wink`, `alert` e `comet` como
   reservados e o teste `mascote-bloub` exigia 4 ativos, enquanto docs/mascotes.md e `renderFalaViva` os usam. Mudou: os
   três entram como ativos com a situação do chat, e o teste lista os sete por nome.
8. **[P2] Nenhum teste provava que `decisao_criada` leva `mensagem_json`.** O unitário de `pedir-a-pessoa` passa a abrir o
   JSON do evento e conferir id (o mesmo da gravada), autoria e payload.

### O que ficou diferente do plano (além de "O que a execução mudou")

- **A promoção não é um campo.** O plano previa `promovidoEm` no estado (marcado uma vez); a execução deriva a cada render
  (`falaNoBalao(a, fim)`: `atual` > 280 ou fim do turno). Anda numa direção só porque `atual` só cresce (`comTexto`
  concatena) e o fim é terminal; o teste cobre. Sem o campo, a direção única não é travada pelo tipo: se um dia `atual`
  encolher, o balão sumiria. Aceito; o teste de `baloes-na-conversa` ("os balões só crescem") é a guarda.
- **O vigia continua um bloco próprio** (`renderAvisoDoVigia`, âmbar, com o Parar) abaixo do pensamento; o cabeçalho diz
  "Sem novidade há N min" em `--warning`. O plano punha o Parar ao lado no cabeçalho.
- **A faixa conta as ações desde a primeira** (o plano dizia "a partir de 5").
- **Parte 4 só para a pergunta** (`pedido_a_pessoa`); o cartão do revisor continua pela releitura.
- **A Parte 5 entrou na Parte 2**, sem commit próprio: `fala-troca` e o rodapé de −25 px saíram; `geracaoDoBalao` ficou
  (as chaves dos balões do relatório longo).
- **`play` depois de Aprovar** e os quatro estados fora do chat não entraram.

### Riscos aceitos

- A janela de latência do POST: quando a releitura chega antes, a pendente e a gravada ficam as duas à vista por dezenas
  de ms (medido só em raciocínio, não cronometrado). Fechar de vez pede o `idEnvio` na `Mensagem` do DTO (servidor).
- O rascunho é apagado no clique (`limparDepoisDeEnviar` roda antes do POST): recarregar a página no meio do POST perde a
  fala, que é só memória. O plano dizia que o rascunho guardaria o texto até o POST voltar; guardá-lo traria o texto de
  volta ao campo mesmo com a fala já enviada (duplicata). Decisão de produto; fica como está.
- A segunda fala durante o turno aparece "enviando" (balão mais claro), não "Na fila · Cancelar": o `fila-na_fila` só
  entra quando a releitura traz a gravada e os `turnosPendentes`. Uma viagem de diferença.
- 401 no envio: a pendente fica "enviando"; o erro vai para a faixa e a tela pede login.
- "Esperando sua aprovação/resposta" lê `suaVez`, que chega uma releitura depois do frame: com a Parte 4 o cartão da
  pergunta aparece do frame e o cabeçalho ainda diz "Pensando" com brilho por um GET.
- `mensagem_json` duplica o texto da pergunta na `events` (outbox) e no frame; o texto é limitado pelo contrato da
  ferramenta e a web ignora acima de 64 KB.
- O mascote que aparece ou some recria o bloco (`planoDoMorph` null): caso raro, já registrado pela execução.
- `nota` por ação aproxima a ordem notas/ações depois de 200 narrações descartadas (ADR-129, riscos).
- Rajada de ferramentas abaixo de 600 ms: só a última aparece (gatilho da ADR-129 para baixar `PERMANENCIA_MS`).
- `data-estado="pensando"` no mascote do chat com turno rodando (no mapa geral, "pensando" = na fila): só o `state` do
  Bloub muda; nenhum CSS distingue.
- O gatilho de reversão da ADR-129 ("taxa de abertura do detalhe perto de zero") não tem medição: `telemetria-linhas.ts`
  não conhece o pensamento. Pendência abaixo.
- `alert` × `idle + somnolent` no silêncio: continua para as capturas (`MASCOTE_NO_SILENCIO`).
- `color-mix` e `background-clip: text` no brilho: Electron e Chrome atuais; `forced-colors` e `prefers-reduced-motion`
  desligam o gradiente (testes de CSS cobrem).

### Mapa de testes

```
SERVIDOR                                                    TELA (tests/unit/web)
assentar-turno: duracaoMs no payload acoes_do_turno    [I]  reducer: pendente nasce, confirma por id, sai na
   (acoes-do-turno: 3 cenários; rodado no banco da worktree)   releitura certa, falha com motivo, descarta, corrida
pedir-a-pessoa: decisao_criada leva mensagem_json      [U]    releitura × POST, servidor sem ids           [U] fala-pendente
   (id da gravada, autoria, payload)                        histórico: chave igual pendente ↔ gravada, ordem,
contrato: PayloadMensagem.duracaoMs opcional       [tsc]      mesmos nós da gravada, sem ações             [U] fala-pendente
perguntas-conversa, sua-vez-pergunta: inalterados      [I]  falaNoBalao: limiar, fim, relatórios, trechos  [U] pensamento
                                                            falaNoBalao(fim) = falaComposta = comporFala   [U] fala-paridade
                                                            itensDoPensamento: notas, grupos ×N, falhas,
                                                              teto GRUPOS_A_VISTA e "N anteriores"         [U] pensamento
                                                            comCabecalho (permanência, última vence),
                                                              escreverEstados, relógio 200 ms              [U] pensamento
                                                            trocarConteudo mantém o open                   [U] pensamento
                                                            renderFalaViva: fases, faixa, sem balão curto,
                                                              promoção, "Pensou por", gravada igual letra
                                                              a letra, vigia no cabeçalho, cor na raiz     [U] conversa-depois
                                                            mascote: thinking/alert/wink/comet/notify,
                                                              proximaViradaDoMascote                       [U] conversa-depois, pensamento
                                                            mensagemDoFrame: forma, autoria, 64 KB, dedup,
                                                              conversa não carregada                       [U] pensamento
                                                            catálogo Bloub: os 7 ativos por nome           [U] mascote-bloub
                                                            CSS: reduced-motion, forced-colors, summary,
                                                              grid-template-rows, tokens                   [U] morph-da-fala, conversa-depois, cores-por-token
e2e-catcher: inalterado (a rota, os frames e o payload são compatíveis; a fala pendente é só web)      [E2E]
capturas protótipo × app dos dez cenários (#ferramentas … #fila)                                   [manual, no PR]
```

[U] unit, [I] integração com Postgres, [E2E] `tests/concurrency/e2e-catcher.test.ts`.

Sem teste (sabido): `enviarComposer` e `reenviarPendente` (main.ts não tem teste de unidade; a lógica testável está
no reducer e em `idsDaResposta`); `escreverEstados` sobre o DOM de verdade; a animação de `grid-template-rows`; o
contraste das 12 skins nos dois temas (capturas).

### Falhas em produção

```
caminho                 falha realista                              teste  tratamento                                visível?
POST da fala            rede cai / servidor reinicia                sim    pedirDeNovoSeCair; depois "falhou" + motivo "Não foi enviada. <frase>", Tentar de novo
POST da fala            releitura chega antes da resposta           sim    a confirmação só tira a pendente          duas falas por dezenas de ms
POST da fala            resposta some (timeout do pedir)            não    envios libera; vira "falhou"              sim, com a frase de rede
POST da fala            401                                         não    faixa + login; pendente fica "enviando"   sim (faixa)
decisao.nova            mensagem_json fora da forma / sem autoria   sim    ignora e relê                             cartão uma viagem depois
turno.delta em rajada   trocas < 600 ms entre si                    sim    pendente no estado, a última vence        só a última
fim do turno            texto curto nunca promovido ao vivo         sim    promoção no fim (regra do servidor)       balão só no fim
gravada                 payload sem duracaoMs (servidor de antes)   sim    linha sem o tempo                         "2 ações"
gravada                 payload fora da forma (jsonb antigo)        sim    sem pensamento, fala inteira              sim
```

Nenhuma falha sem teste, sem tratamento e silenciosa ao mesmo tempo.

### O que já existe e é reaproveitado (conferido)

`envios.iniciar/concluir` e `corpoDoEnvio` (a chave de idempotência), `pedirDeNovoSeCair` (a repetição por rede com a
chave), `RespostaMutacao.ids`, `regiaoPorBlocos` + `planoDoMorph` + `trocarConteudo` (`data-no-lugar`), `data-disclosure`,
`criarRelogioDaFala` e `escreverTempos`, `linhasDoResumo`/`vezes`, `ACOES_GUARDADAS` e `ETAPAS_GUARDADAS`,
`renderAvisoDoVigia`, `renderTarefasDoBot`, `iconeAgente`/`htmlMascote`, `--mascote-cor` por classe `c-*` (estilos.css),
`criarAnunciador` com o `.sr-only.fala-viva-anuncio`.

### Pendências (fora do escopo desta branch; considerado e adiado)

- `idEnvio` na `Mensagem` do DTO: fecha de vez a corrida releitura × POST e deixa a pendente sair pela chave, como o plano
  escreveu em "Riscos". Servidor + contrato; PR próprio.
- Medição do gatilho de reversão da ADR-129: um `TipoLinha` para "pensamento aberto" em `telemetria-linhas.ts` e a
  contagem de relatos de "balão que some". Sem isso o gatilho de 30 dias não é verificável.
- Cartão do revisor nascendo do frame (o DTO é montado na leitura: itens, prazos).
- `play` depois de Aprovar/Retomar (precisa do turno no frame `decisao.decidida`); `egg`, `hexagon`, `burst`, `exclaim`
  fora do chat.
- "Na fila · Cancelar" na pendente antes da releitura (hoje só "enviando").
- Rascunho até o POST voltar (decisão de produto: duplicata × perda num recarregamento).
- Agrupar as falas do mesmo turno num bloco (decisão 3 de 26/10; não entrou neste PR).
- Promoção como campo do estado (`promovidoEm`), se a derivação por render der trabalho em algum caso novo.
- As capturas dos dez cenários do protótipo e a escolha `alert` × `somnolent`: no PR, antes do merge.

### Paralelização

Sequencial: o PR já está implementado; a revisão é sobre ele.

## Revisão do PR (27/10)

`/review` (gstack) sobre o diff contra a `main`, com dois revisores adversariais independentes (Codex não instalado;
sessão autônoma, decisões pelo menor risco). Linha de base: 185 arquivos / 2.525 testes do `unit` da web verdes. O que
era defeito claro, pequeno e seguro virou código e teste no mesmo commit; o discutível está no comentário do PR #534.

1. **[P1] A primeira ferramenta sem narração antes puxava as notas posteriores para antes dela.** `comAcao` omite `nota`
   quando é zero, e `itensDoPensamento` lia `?? Infinity`. Agora `?? 0`. Teste em `pensamento.test.ts`.
2. **[P1] Depois do `turno.fala`, a narração nova entrava antes das ações antigas.** `semTexto` e `soSubagentes` zeram
   `antes`, mas as ações guardavam o `nota` da volta passada. Agora `acoesSemNota` (atividade.ts). Teste em
   `acoes-do-turno.test.ts`.
3. **[P1] A gravada reagrupava diferente do vivo.** O servidor (`acoesDoTurno`) separa a mesma ferramenta por desfecho; a
   viva junta num grupo (×N · N falharam). `renderResumoDasAcoes` passa a juntar igual. Teste em `conversa-depois.test.ts`.
4. **[P1] "Tentar de novo" podia gravar a fala duas vezes.** `envios.iniciar` só reaproveitava a chave da ÚLTIMA fala da
   conversa; outra fala no meio trocava a chave. Agora `iniciar` aceita a chave dada e o reenvio manda a da pendente.
   Teste em `envio-idempotente.test.ts`.
5. **[P1] O foco do teclado caía no `<body>` a cada troca do pensamento.** `regiaoPorBlocos` lia o disclosure do
   `<summary>` focado DEPOIS do morph, e `trocarConteudo` já tinha destacado o summary antigo do `<details>` que fica.
   Agora lê antes. Teste (por fonte, como os vizinhos) em `morph-da-fala.test.ts`.
6. **[P2] `comFerramenta` perdia `frentesEm`:** a segunda frente aberta logo depois cortava o `comet`. Teste em `pensamento`.
7. **[P2] O `motivo` da falha anterior ficava grudado no reenvio** (AbortError sem frase mostrava a frase do limite do
   plano). O reenvio tira o motivo e o reducer grava só o desta falha. Teste em `fala-pendente.test.ts`.
8. **[P2] A cópia otimista do resumo na gravada (`comAcoesNaUltimaGravada`) não levava `duracaoMs`:** o cabeçalho dizia
   "2 ações" e virava "Pensou por 9 s · 2 ações" na releitura. Leva o tempo do relógio da web. Teste em `acoes-do-turno`.
9. **[P2] `mensagemDoFrame` não conferia `opcoes`:** o cartão faz `.map`; fora de lista derrubaria o render. Teste em `pensamento`.
10. **[P2] `textoEscrevendo` recompunha a fala inteira (`falaNoBalao`) a cada delta** só para ler `promovido`, que com
    `atual` não vazio é `atual.trim().length > PROMOCAO_CHARS`. Trocado pela comparação; a paridade continua testada.

Depois: 185 arquivos / 2.530 testes verdes; `tsc` da web e do servidor limpos; eslint limpo nos arquivos tocados;
`acoes-do-turno` de integração (5) e `pedir-a-pessoa` verdes.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (IMPL) | 8 issues viraram código e teste; 13 riscos registrados; 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **VERDICT:** ENG CLEARED — a implementação segue o plano e as decisões de 26/10; as oito mudanças desta revisão estão na
  branch com teste; o que resta é pendência registrada (idEnvio no DTO, medição do gatilho, capturas antes do merge). As
  decisões desta revisão foram tomadas pelo revisor, em sessão autônoma, no lugar do Marlon, e podem ser revertidas.

NO UNRESOLVED DECISIONS
