# ADR-077 — Onboarding por ligação

Status: aceito, não homologado com voz e IA reais · Data: 2026-10-04 · Fase 5 do
[plano do modo ligação](../plano-modo-ligacao.md) (protótipo "Proposta 2", aprovado em 2026-10-03). Usa a ligação da
ADR-072, a aprovação por voz da ADR-074 e o consentimento da ADR-075.

## Contexto

A pessoa nova abria o nod numa tela vazia ("Novo bot") e tinha de descobrir sozinha bot, app e rotina. O protótipo
aprovado troca isso por uma ligação: "olá", a IA do Mac (só se nenhuma estiver logada), a primeira bot liga, uma
entrevista curta em tela cheia e, com a ligação encolhida na pílula, a bot guia monta o primeiro bot, o app dele e uma
rotina dele.

## Decisão

- **Estado em `preferencias` (0049, só adição).** `onboarding_etapa` (`ola`, `executor`, `chamando`, `entrevista`,
  `configurando`, `concluido`), a guia (`onboarding_guia_id`), o bot novo (`onboarding_bot_id`), a conclusão e o que a
  pessoa contou (`apelido` ≤60, `como_conheceu` ≤200, `objetivo` ≤500, `tamanho_time` em 4 faixas). Backfill entre
  NO FORCE/FORCE (regra da 0005): quem já tem bot confirmado ou chave de máquina é marcado concluído. O passo da
  configuração (bot → app → rotina → fim) é calculado do banco a cada `GET onboarding`, nunca guardado. Mostrar o
  onboarding = não concluiu e (está no meio ou não tem bot confirmado): quem chegou com bots depois da migração (seed)
  não o vê sem pedir.
- **Rotas** `GET /onboarding`, `POST /onboarding/etapa`, `POST /onboarding/concluir`, mais os atalhos do caminho sem
  voz `POST /onboarding/bot` e `POST /onboarding/rotina`. Entrar em `chamando` garante a guia (a salva, senão uma nova
  pelo `criar-agente`, com nome livre: "Nina", "Nina 2"…; voz feminina, mascote azul) e cria a ligação com
  `iniciadaPor:"produto"`, tocando. **O "Atender" é o consentimento**: a ligação do produto nasce sem ele, o
  orquestrador recusa a mídia (4403) até `liberar`, e `etapa:"entrevista"` só passa com o consentimento gravado. Sem o
  Atender em 2 min, a ligação vira não atendida. "Configurar sem voz" encerra a ligação como recusada.
- **Ferramentas do laço de voz só no onboarding** (`anotar_entrevista`, `concluir_entrevista`, `propor_bot`): entram no
  catálogo `ligacao` só quando a ligação é do produto, da guia, com o onboarding numa etapa da ligação
  (`montarPlano({onboarding})`), e cada caso de uso confere o mesmo contexto. O apelido vira o `pessoaNome` de todos os
  prompts; o objetivo vira memória da guia; origem e tamanho viram log sem texto.
- **O orquestrador conduz; o modelo extrai.** A primeira fala é roteiro (sem esperar o cérebro). O prompt de voz da
  primeira ligação lista as quatro perguntas, o resumo "Certo?" e os três passos, depois do marcador dinâmico (muda a
  cada campo). Quando uma ferramenta do onboarding termina no cérebro, o orquestrador relê o estado e manda à mídia
  `{t:"onboarding", etapa, campos}` (o painel "O que você contou"; `configurando` encolhe para a pílula) e
  `{t:"sugestoes", itens}` (os chips "Diga algo como", textos fixos do protótipo, por etapa e passo).
- **O primeiro bot é uma proposta** (`kind_proposta`/`tipo_decisao` `bot`, 0050 só de enum): o card "Novo bot ·
  preenchido com o que você contou" se confirma por clique (com nome e descrição editados) ou por voz ("pode criar",
  perfil `proposta`). Confirmado, ele vira o `onboarding_bot_id`.
- **`para_bot`** em `pedir_acesso` e `criar_rotina`: vale só para o `onboarding_bot_id`, no turno da ligação de
  onboarding. O card nasce na conversa do bot novo, com o agente dele e sem turno (a retomada do acesso é do turno de
  quem pediu, noutra conversa). A ligação acompanha também essas decisões (`leituraDaDecisao({soDoBotDoOnboarding})`).
- **Quatro modelos de bot no domínio** (`src/domain/roteiro-onboarding.ts`): clientes (Gmail), time (ClickUp), dia
  (Google Agenda) e código (GitHub), cada um com nome, descrição, mascote, app, o que pode e não pode e três rotinas.
  O objetivo dito escolhe o modelo por palavras-chave; nada casa = clientes, que também é o do caminho sem voz.
- **Desktop:** sem IA pronta, o app abre a janela mesmo assim (a web mostra os cards de IA) e sonda a cada 3 s até uma
  ficar pronta, então sobe o laço e reanuncia. "Entrar" roda `claude auth login`/`codex login` (o nod nunca vê token);
  "Instalar" abre a página oficial.
- `NOD_ONBOARDING_VOZ=1` abre a ligação de onboarding mesmo com `NOD_LIGACAO=admins`.

## Alternativas descartadas

- **Formulário de configuração sem ligação.** É o caminho "sem voz", não o principal: o protótipo aprovado é a ligação.
- **A web decidir a etapa.** A etapa liga a guia, a ligação e o consentimento; o cliente só pede.
- **O modelo conduzir a entrevista sozinho.** Ele esquecia perguntas e repetia; o roteiro é do servidor, o modelo só
  anota.
- **Card único com bot, app e rotina** (ADR-050). Três cards seguem o protótipo e cada um se decide por voz.

## Custo aceito

- O objetivo por palavras-chave erra frases fora do vocabulário; a pessoa corrige no card antes de criar.
- O backfill marca concluído quem tinha só uma chave de máquina (sem bot): perde o onboarding, pode pedir de novo.
- A rotina "15 min antes de cada reunião" do protótipo virou "Dias úteis, 8:00": o cron não expressa "antes do evento".

## Validação

- `tests/concurrency/onboarding-catcher.test.ts` (catcher + voz falsa): GET → chamando (ligação do produto) → mídia
  recusada sem o Atender → consentimento → entrevista → os quatro `anotar_entrevista` → `concluir_entrevista` →
  `propor_bot` aprovado por voz → bot criado → `pedir_acesso` e `criar_rotina` com `para_bot` (rotina aprovada por voz)
  → concluir.
- `tests/integration/onboarding.test.ts`: backfill da 0049, CHECKs e as rotas (sem voz, com voz, pessoa com bot).
- `tests/unit/domain/roteiro-onboarding.test.ts`, `tests/unit/voz/orquestrador-onboarding.test.ts`,
  `tests/unit/web/onboarding.test.ts`, `tests/unit/desktop/ia-mac.test.ts`.

## Gatilho de reversão

- Pessoas novas internas não terminam por voz em ≤10 min (saída da fase 5) ou abandonam na ligação: o caminho sem voz
  vira o padrão e a ligação passa a ser opção.

## Não implementado

- Modo de turno `onboarding` no texto (só a ligação tem as ferramentas).
- "Atualizar" (`claude update`) e o instalador do Codex com SHA-256 fixado nos cards de IA.
- O card ChatGPT seguir para o caminho sem voz com "voz com ChatGPT em breve" (o Codex já liga, ADR-076).
