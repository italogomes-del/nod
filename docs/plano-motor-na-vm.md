# Plano: o motor do nod numa VM ("traga sua VM")

> Proposto e implementado em 2026-10-09. Decisão em [ADR-090](adr/adr-090-o-motor-numa-maquina-linux-da-pessoa.md); como conectar e testar: [motor-na-vm.md](motor-na-vm.md). Aula com os
> diagramas: https://claude.ai/artifact/9s7Evq2HLyixCeMncVSnaV. As costuras foram conferidas no `main` em 2f98ed6.

## Objetivo

A pessoa conecta uma VM Linux sua ao nod, escolhe quais bots trabalham nela, e o Mac deixa de rodar esses turnos. O Mac
(ou qualquer navegador) continua sendo a janela. Fora de escopo: os computadores dos bots (ADR-037), o caminho B (o nod
cria a VM na conta da pessoa) e o caminho C (o nod hospeda).

## Decisões do Marlon (2026-10-09)

| Tema | Decisão |
|---|---|
| Forma | **Híbrido**: Mac/navegador é a janela, a VM é o motor |
| Arquivos | **Ficam onde o bot trabalha**; sem sincronização com o Mac |
| Máquina escolhida fora do ar | Recomendação adotada: o que não começou espera (com "rodar em outra desta vez" por clique); rotina não migra; o que já começou segue a ADR-045 |
| Termos de uso | Conferidos: login feito pela própria pessoa na VM dela está coberto |
| Caminhos | **A (traga sua VM) primeiro**, B em breve, C fora |
| Computadores dos bots | Só documentar opções; não implementar nada caro |

## Protótipo (aprovado em 2026-10-09)

Canvas interativo: https://claude.ai/artifact/JUUCPV7Y7hjnUGzw6rbr3J. A cópia que não depende de acesso ao canvas
está em [docs/prototipos/motor-na-vm/](prototipos/motor-na-vm/): um PNG por estado em `telas/` e o código das telas em
`fonte/`, para reabrir num canvas novo.

| Tela | Captura |
|---|---|
| Seu espaço › Máquinas | [01](prototipos/motor-na-vm/telas/01-maquinas.png) · VM fora do ar: [02](prototipos/motor-na-vm/telas/02-maquinas-vm-fora-do-ar.png) |
| Conectar uma máquina (5 passos) | [03](prototipos/motor-na-vm/telas/03-conectar-1-preparar.png) · [04](prototipos/motor-na-vm/telas/04-conectar-2-instalar.png) · [05](prototipos/motor-na-vm/telas/05-conectar-3-codigo.png) · [06](prototipos/motor-na-vm/telas/06-conectar-4-entrar-nas-ias.png) · [07](prototipos/motor-na-vm/telas/07-conectar-4-claude-pronto.png) · [08](prototipos/motor-na-vm/telas/08-conectar-5-escolher-bots.png) |
| Terminal da VM | [09](prototipos/motor-na-vm/telas/09-terminal-da-vm.png) |
| Conversa | bot na VM: [10](prototipos/motor-na-vm/telas/10-conversa-bot-na-vm.png) · VM fora do ar: [11](prototipos/motor-na-vm/telas/11-conversa-vm-fora-aviso-na-mensagem.png) · rodou no Mac desta vez: [12](prototipos/motor-na-vm/telas/12-conversa-rodou-no-mac-desta-vez.png) |

Decisões tomadas no protótipo:
- **Aviso da máquina fora do ar na conversa: dentro da mensagem que está na fila (4c), sem faixa.** A linha da fila diz
  "Na fila · a vm-sp não responde desde 14:32" e traz "Rodar no MacBook desta vez" ao lado de "Cancelar". No
  cabeçalho, o chip "vm-sp · sem contato" fica neutro, com um ponto âmbar. A faixa âmbar acima do campo (13) e a faixa
  neutra (14) foram descartadas: o Marlon achou a faixa âmbar poluída, e a 4c é a mais limpa.
- **Escolher os bots ao conectar** tem "Marcar todos" e "Nenhum", com a contagem ("4 de 5 bots").
- **"Máquinas" é uma seção nova de Seu espaço** e absorve "Este Mac" (ADR-085): cada máquina tem os próprios medidores.

## O que já existe e ajuda

- **A máquina disca** (ADR-021). A VM precisa só de saída HTTPS. `/api/maquina/*` em `src/adapters/http/rotas/ponte.ts`.
- **Várias máquinas por pessoa.** Cada chave tem a sua `PonteInternaNod` (`compor.ts`), o `reivindicar` grava
  `machine_id` (`src/repositories/turnos.repo.ts`) e renovar/entregar exigem a mesma máquina.
- **Sem sessão presa à máquina.** No modo compartilhado o `--resume` já é desligado e o histórico vai no plano
  (`permitirResume: !compartilhado`).
- **O motor já é quase todo Node puro.** O modo local do servidor sobe os mesmos drivers sem Electron
  (`src/adapters/http/boot.ts`); o que é Electron no caminho do turno é pouco (tabela da etapa 1).
- **Voz.** O cérebro da ligação é o motor, por WebSocket com o `WebSocket` global do Node 24; STT/TTS ficam no servidor.
- **gh.** Já roda no motor (proxy `executarLocal` e `/api/maquina/itens-locais`); na VM basta `gh auth login`.

## Etapas

Cada etapa entrega algo usável e tem um aceite que é teste.

### Etapa 0 — medir antes (sem código)

Dimensionar a VM a partir do que já foi medido (ADR-085): ~300 MB por `claude -p`, p50 de 3 e p90 de 7 turnos ao mesmo
tempo, e os comandos dos bots como o maior consumo de processador. Ponto de partida para recomendar na tela:

| Uso | VM sugerida | Conta |
|---|---|---|
| Leve (até ~3 turnos juntos) | 2 vCPU, 4 GB | 3 × 300 MB + sistema + folga para comandos |
| Como o diário (p90 de 7) | 4 vCPU, 8 GB | 7 × 300 MB ≈ 2,1 GB + comandos de teste e build |

Esses números são derivados, não medidos numa VM. A primeira VM conectada mede de verdade (etapa 1 já manda memória e
processador).

### Etapa 1 — motor sem janela

Um ponto de entrada Node (sugestão: `motor/main.ts`, com tsconfig próprio como `desktop/`, ADR-018) que faz o que
`conectar()` de `desktop/main.ts` faz, sem Electron.

| Hoje no Electron | No motor |
|---|---|
| `safeStorage` guarda `{url, chave}` em `userData/conexao.enc` | arquivo 0600 em `NOD_MOTOR_HOME` (ou variável de ambiente) |
| `app.getPath("userData")` para `executor/`, `ias-testadas.json` | `NOD_MOTOR_HOME` |
| `app.getVersion()` no `x-nod-versao` | versão do `package.json`, no formato `x.y.z[-rc.N]` (`domain/versao-app.ts` recusa o resto) |
| proxy MCP e hook via `process.execPath` + `ELECTRON_RUN_AS_NODE` | `electronComoNode: false`, `nodePath` = node; bundles já gerados por `scripts/desktop/build.mjs` (`proxy.mjs`, `hook-nativas.mjs`, `platform: node`) |
| `desktop/vigia-ias.ts`, partes puras de `parear.ts`, `diagnostico.ts`, `avisos-mac.ts` | mover para `src/adapters/executor/` (já não usam Electron) e importar dos dois lados |
| log em `~/Library/Logs/nod` | stdout (o systemd/journald guarda) |
| `Notification`, `Menu`, `BrowserWindow`, `nativeTheme`, `powerSaveBlocker`, microfone | não se aplica |

Também nesta etapa:
- **`plataforma` no anúncio** (`src/contracts/ponte.ts`, `AnuncioMaquina`): `darwin` | `linux`, opcional (app antigo =
  `darwin`). O servidor guarda na conexão.
- **Amostrador fora do macOS** (`src/adapters/executor/amostrador-memoria.ts` só lê em `darwin`): no Linux, processador
  por `os.loadavg()` (já é o que vale) e memória por `MemAvailable` de `/proc/meminfo`, convertidos no mesmo
  `nivelDoProcessador` / nível de memória de `src/domain/memoria-mac.ts`.
- **Saída manual já possível:** `{url, chave}` com a chave criada em "Chaves" (`web/main.ts`), para testar antes da
  etapa 2.

**Aceite:** teste de concorrência com o servidor em `NOD_MODO=compartilhado`, o motor sem Electron e o driver `catcher`:
conecta, puxa, renova, entrega; `pedir_a_pessoa` e `pedir_aprovacao` vão e voltam no meio do turno (o critério mecânico
da pré-ADR-030/ADR-028); dois motores da mesma pessoa não pegam o mesmo turno.

### Etapa 2 — pareamento por código

Fluxo de dispositivo (RFC 8628), ao lado do pareamento do Mac (ADR-069):

1. `POST /api/pareamento/dispositivo` (pública, recusa `Origin`): `{nome, plataforma}` → `{codigoDispositivo,
   codigoPessoa, enderecoVerificacao, intervalo}`. `codigoPessoa` com 8 caracteres sem ambíguos (sem 0/O, 1/I/L).
2. A web, com sessão, em "Conectar uma máquina": digitar o código → "Conectar <nome> (Linux)?" → confirmar. Abre também
   por `?parear-maquina=<codigo>` para quem clica no link mostrado no terminal.
3. `POST /api/pareamento/dispositivo/trocar` (pública, recusa `Origin`): a máquina pergunta a cada `intervalo`
   segundos; depois de confirmado, recebe a chave de `emitirChaveMaquina` no escopo de quem confirmou. Uso único.
4. Em memória, como `src/services/pareamento-maquina.ts`: prazo de 10 min, 5 tentativas erradas por código, toda troca
   consome. Mesmo gatilho da ADR-069 para ir ao banco (réplicas).

**Aceite:** integração: código certo emite chave no escopo de quem confirmou; código vencido, repetido ou de outra
pessoa não emite; `Origin` dá 403; a chave aparece em "Chaves" com o nome da máquina e se revoga igual.

### Etapa 3 — instalar e logar

- **Instalação por uma linha**, servida pelo próprio servidor (ele sabe o endereço e a versão):
  `curl -fsSL https://<servidor>/motor | sh`. O script cria o usuário `nod`, instala Node 24, o motor, `git` e `gh`,
  e os CLIs que a pessoa escolher, e registra o serviço `nod-motor` no systemd. No fim, inicia o pareamento e mostra o
  código.
- **Login das IAs, pela pessoa, no terminal da VM:** `nod-motor entrar claude` / `nod-motor entrar codex` /
  `nod-motor entrar github` abrem o login de cada CLI como o usuário `nod` (fluxos para máquina sem navegador). A tela
  do nod mostra esses comandos e a vigia das IAs marca "pronto" sozinha (ADR-019, sem ler credencial).
- **Atualização:** `nod-motor atualizar` e um timer diário do systemd; o 426 `atualize_app` faz o motor parar e
  escrever no log o comando para atualizar (ADR-020, sem auto-update embutido).
- **Higiene da VM** (mostrada na tela, aplicada pelo script quando possível): VM só para o nod, atualizações de
  segurança automáticas, SSH só por chave. A VM guarda o login da pessoa e o bot tem terminal com rede (ADR-055):
  quem invade a VM usa as contas dela.

**Decidido em 2026-10-09: instalar direto no sistema**, como serviço do systemd sob o usuário `nod`. O terminal do bot
é o terminal de verdade da VM, como a ADR-055 promete no Mac, e o que ele instala fica. Imagem Docker descartada: seria
reprodutível, mas o que o bot instala sumiria na recriação e o terminal viraria o de um container.

**Aceite:** numa VM Debian 12 limpa, do `curl` ao primeiro turno real respondido, sem abrir porta nem editar arquivo.

### Etapa 4 — onde cada bot trabalha

- **Dado:** a máquina de cada bot (nula = qualquer) e um padrão por pessoa (em `preferencias`). A máquina é o id da
  chave; revogar a chave deixa os bots dela "sem máquina" e a tela pede para escolher.
- **Regra no `reivindicar`** (`turnos.repo.ts`): turno de bot preso a uma máquina só sai para ela, exceto o turno com
  "rodar em <outra> desta vez" marcado pela pessoa. Junto dos filtros que já existem (harness pronto, ligação, uso da
  máquina da ADR-085).
- **Máquina fora do ar:** conversa/task/colega que não começou fica pendente. Na conversa, sem faixa: a linha da
  mensagem na fila diz "Na fila · <máquina> não responde desde HH:MM" com "Rodar em <outra> desta vez" e "Cancelar"
  (protótipo, tela 11). Rotina vira `interrompida` com o aviso da ADR-045; o que já começou segue a ADR-045.
- **Tela:** Seu espaço › Máquinas (lista Mac e VMs com estado, IAs prontas, memória e processador, e "Desconectar");
  no perfil do bot, "Trabalha em"; na conversa, "rodou em <nome>" no lugar dos 8 primeiros caracteres do id
  (`web/telas/conversa.ts`).

**Aceite:** concorrência: bot preso à VM nunca roda no Mac com os dois conectados; com a VM fora, o turno espera e o
botão da pessoa o solta para o Mac; rotina com a VM fora vira `interrompida` com um aviso só.

### Etapa 5 — o nod deixa de dizer "Mac" quando não é

- `src/domain/prompt-sistema.ts`: "sua pasta no Mac de <pessoa> … abre no Finder", "o terminal de verdade do Mac",
  "credencial do Mac". O plano passa a levar `maquina: {nome, plataforma}` e o texto sai por plataforma. Atualizar
  `__prompts__/` com `npm run prompt:referencia` e revisar o diff (NOD-163).
- Mensagens: `rotas/ponte.ts` ("Abra o app nod…"), `web/telas/sua-vez.ts` ("aguardando seu Mac"), os avisos da ADR-045
  e as telas da ADR-085/086 ("Este Mac", "fora do Mac"), que passam a nomear a máquina.

**Aceite:** prompts de referência novos para um turno em `linux`; unit das mensagens por plataforma.

### Depois — caminho B (o nod cria a VM na conta da pessoa)

Mesmo motor. O nod usa a API do provedor com um token da pessoa (no cofre, ADR-015) e sobe a VM com cloud-init que já
traz um pareamento pré-aprovado de uso único, então não há código para digitar. Só o login das IAs continua no terminal.
Começar por um provedor de API simples. Fica para ADR própria.

## Computadores dos bots: só as opções (não implementar agora)

Hoje o driver Docker roda no processo do servidor (`src/adapters/computador/docker.ts`) e o motor só repassa as
ferramentas `computador_*` ao servidor. A feature não está em uso por causa dos bugs. Quando voltar, estas são as opções:

| Opção | Prós | Contras |
|---|---|---|
| **1. Deixar desligado até estabilizar** (recomendada agora) | Custo zero; o motor na VM não depende disso | Bots seguem sem desktop próprio |
| **2. Continuar no host do servidor** | Nada a mudar | A VM do servidor (e2-medium) não comporta vários de 2 GB; todas as pessoas no mesmo host, isoladas só por container |
| **3. Computadores no motor da VM da pessoa** | Usa a máquina da pessoa; Docker nativo no Linux, sem Docker Desktop; cresce com cada pessoa | O servidor não alcança o Docker da VM (ADR-021): as ações viram trabalho puxado pelo motor, no molde de `/api/maquina/itens-locais` do gh; dois caminhos para manter (servidor e motor) |
| **4. Provedor externo de desktops** | Sem infraestrutura nossa | Custo por uso, mais um fornecedor com acesso às sessões dos bots, latência |

Se a opção 3 for escolhida um dia, o precedente do gh (o servidor entrega, o motor executa e devolve) é o caminho de
menor mudança, e a pré-ADR-030 (cérebro e proxy juntos, mãos onde estiverem) continua valendo.

## Relação com outras ADRs

- **ADR-086, "PR3":** a ADR-086 diz que tirar do Mac o comando do próprio bot (testes, build) é o PR3. Para quem
  conecta uma VM, esta feature resolve isso: bot que trabalha na VM roda os comandos na VM. Vale decidir se o PR3 ainda
  é necessário para quem fica só no Mac.
- **ADR-085:** o uso da máquina passa a valer por máquina, inclusive Linux; a tela sai de "Este Mac" para a máquina.
- **ADR-045:** a queda vira "da máquina", com o nome dela.

## Riscos conhecidos

- **Uma chave por VM.** Duas instâncias com a mesma chave colidem (`puxando` dá `estado_invalido`; conectar com turnos
  vivos há menos de 90 s é recusado). O script não deve rodar dois motores com a mesma configuração.
- **Presença.** A VM some da tela depois de 60 s sem contato e a conexão é esquecida aos 90 s (`varrer`). Um deploy do
  servidor faz as máquinas reconectarem; o 409 → reanunciar já existe.
- **Codex e a pasta do bot.** O driver do Codex não usa `pastaDoBot` (só `--cd` com pastas de workspace, que não
  existem no compartilhado). Conferir o diretório de trabalho do Codex na VM na etapa 1.
- **Tabela `maquinas`.** Existe desde a 0001 e parece sem uso; a etapa 4 decide se vira o registro das máquinas ou se
  o id da chave basta.

## Revisão de engenharia (2026-10-09, /plan-eng-review)

Rodada em modo autônomo a pedido do Marlon ("plan-eng-review → implementar → review → PR e merge" durante a noite).
As perguntas da revisão foram decididas pela recomendação e ficam registradas aqui.

### Passo 0 — escopo

O plano toca mais de 8 arquivos (motor, ponte, pareamento, despacho, migração, web, prompt, instalação). A meta de
amanhã é o teste real numa VM, então o escopo mínimo é o caminho inteiro de ponta a ponta: motor sem janela,
pareamento por código, instalação, onde cada bot trabalha e o texto do prompt por máquina. Cortes decididos:

- **"Este Mac" continua como está.** A seção nova "Máquinas" lista as máquinas e onde cada bot trabalha; juntar os
  medidores de memória e processador nela fica para depois (o protótipo os mostra, mas o teste de amanhã não depende
  disso).
- **Rotina com a máquina fora do ar** não ganha caminho novo: o turno fica pendente para a máquina dela e o vencimento
  que já existe (ADR-011/045) cuida da janela.
- **Atualização do motor** é manual (`nod-motor atualizar`, que roda a instalação de novo); o timer diário fica para
  depois.
- **Instalação**: Debian e Ubuntu, x64 e arm64.

### 1. Arquitetura

```
 VM (usuário nod, systemd)                 servidor (GCP)                     navegador / app do Mac
 ┌──────────────────────────┐   HTTPS   ┌──────────────────────────┐        ┌───────────────────────┐
 │ nod-motor (motor/main.ts)│──────────▶│ /api/pareamento/dispositivo│◀───────│ Máquinas › Conectar   │
 │  ├ ponte-http (puxar...) │  só sai   │ /api/maquina/* (ponte)    │        │  digita o código      │
 │  ├ laço + pool + drivers │           │ reivindicar: máquina do   │        │ Onde cada bot trabalha│
 │  ├ proxy.mjs / hook.mjs  │           │  bot ou "desta vez"       │◀───────│ "Rodar no X desta vez"│
 │  └ claude / codex / gh   │           │ plano.maquina → prompt    │        └───────────────────────┘
 └──────────────────────────┘           └──────────────────────────┘
```

1. **(P1, 9/10) A identidade da máquina é o id da chave** (`ponte.ts`: `machineId: ctx.params.chaveId`). Se a pessoa
   revogar a chave ou parear de novo, a máquina vira outro id e os bots presos à antiga ficariam pendentes para sempre.
   Decisão: a preferência só vale se a chave existe, é da dona do turno e não foi revogada; senão o turno vai para
   qualquer máquina. A tela mostra "sem máquina" nesse caso.
2. **(P1, 8/10) Distribuição do motor.** Sem pipeline, ninguém instala. Decisão: o build da imagem do servidor gera
   `dist/motor/` (esbuild, como `scripts/desktop/build.mjs`, reusando `desktop/proxy.ts` e `desktop/hook-nativas.ts`)
   e o próprio servidor serve `GET /motor` (o script) e `GET /motor/arquivos/<nome>`. A versão do motor é a do
   servidor que o instalou, então ele nunca fica abaixo da versão mínima daquele servidor.
3. **(P2, 8/10) Pareamento por código em memória**, como o da ADR-069 (uma instância do servidor). Limite de 5
   tentativas por código, prazo de 10 min, uso único.
4. **(P2, 7/10) Segurança da instalação.** O motor roda como o usuário `nod`, nunca root; a chave fica em
   `~nod/.config/nod-motor/conexao.json` (0600). O script só aceita o servidor por HTTPS (loopback em dev).
5. **(P2, 8/10) O bot precisa saber em que máquina está.** O plano de turno ganha `maquina: {nome, plataforma}`,
   preenchido no despacho pelo anúncio da máquina; o prompt troca "Mac" e "Finder" pelo nome da máquina em Linux.

Falha realista por caminho novo: a VM perde a rede no meio do turno → lease vence, ADR-045 vale igual (coberto pelos
testes existentes de lease); a VM fica fora com conversa na fila → a mensagem mostra a máquina e o "Rodar em X desta
vez" (novo, com teste).

### 2. Qualidade de código

1. **(P2, 8/10) DRY no motor.** O `conectar()` do Electron monta registry, ponte, vigia e pool. O motor sem janela
   reusa os mesmos módulos (`src/adapters/executor/*`, `desktop/vigia-ias.ts`, `desktop/ia-mac.ts`, que não usam
   Electron); a costura duplicada fica em `motor/main.ts`, documentada. Mexer no `desktop/main.ts` agora exigiria
   uma release do app para testar, e o motor do Mac não muda.
2. **(P2, 7/10) Comentários longos de decisão** seguem o padrão do repo (data + ADR) nos pontos novos do `reivindicar`.

### 3. Testes

```
CÓDIGO                                            FLUXOS
[+] src/domain/maquina-do-turno.ts                 [+] Conectar uma VM
  ├─ preferência válida / revogada / alheia         ├─ código certo → chave no escopo [integração]
  └─ "desta vez" ganha da preferência  [unit]       ├─ código errado 5x → bloqueado [unit]
[+] services/pareamento-dispositivo.ts              ├─ código vencido / repetido [unit]
  ├─ abrir, aprovar, trocar, prazo, tentativas      └─ Origin → 403 [integração]
[+] turnos.repo reivindicar                        [+] Bot preso à VM
  ├─ bot da VM não sai para o Mac   [concorrência]  ├─ Mac e VM puxando: só a VM leva
  ├─ chave revogada → qualquer máquina              ├─ VM fora + "desta vez no Mac" → Mac leva
  └─ "desta vez" vai para a escolhida               └─ padrão da pessoa vale para bot sem escolha
[+] prompt-sistema por plataforma  [unit + refs]   [+] Motor sem janela [→E2E manual na VM amanhã]
[+] amostrador no Linux (/proc/meminfo) [unit]
[+] web: texto da fila com a máquina fora [unit]
```

Gaps conscientes: o motor rodando de verdade numa VM com Claude real fica para o teste do Marlon (custa assinatura e
precisa da VM).

### 4. Desempenho

Sem achados. O `reivindicar` ganha um join com `preferencias` e uma busca por chave em `maquina_tokens`, pela
chave primária, dentro da transação que já existe.

### NÃO entra agora

- Juntar "Este Mac" em "Máquinas" (medidores por máquina na tela nova).
- Timer de atualização automática do motor.
- Caminho B (criar a VM pela API do provedor) e computadores dos bots no motor.
- Sincronizar arquivos entre VM e Mac (decisão do Marlon: os arquivos ficam onde o bot trabalha).

### O que já existe e é reusado

Laço, pool, drivers, sonda e ponte HTTP (`src/adapters/executor/*`); vigia das IAs e login (`desktop/vigia-ias.ts`,
`desktop/ia-mac.ts`); `emitirChaveMaquina` (ADR-031); o padrão de pareamento em memória (`pareamento-maquina.ts`);
os bundles de proxy e hook do desktop.

### Paralelização

Implementação sequencial: motor, ponte, despacho e prompt compartilham `src/contracts/ponte.ts` e
`src/contracts/plano-turno.ts`.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 7 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | protótipo aprovado pelo Marlon |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **VERDICT:** ENG CLEARED — pronto para implementar (decisões tomadas pela recomendação, modo autônomo).

NO UNRESOLVED DECISIONS
