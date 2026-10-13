# Plano · As contas de IA da pessoa em todas as máquinas (Mac e VM)

Spec de 2026-10-13. Decisões do Marlon no protótipo (canvas "Nod — tela do agente", páginas "Contas e máquinas" e
"Decisão 1 · Gestão"); PNGs em `prototypes/contas-mac-vm/`. A decisão de arquitetura está na
[ADR-102](adr/adr-102-contas-da-pessoa-em-todas-as-maquinas.md). Estende a ADR-101 (várias contas por IA), a ADR-090
(motor na VM) e a ADR-019 (a sonda pergunta ao CLI, nunca lê a credencial).

## Contexto

Desde a ADR-101 o app do Mac guarda várias contas por IA, com ordem e "Perguntar antes"/"Trocar sozinho". A VM (ADR-090)
ficou de fora:

- **A conta da VM é outra história.** O login é no terminal (`nod-motor entrar claude`): três saltos (web → SSH → outro
  aparelho → colar no terminal). A VM tem uma conta por IA, sem relação com as do Mac.
- **Duas telas, duas verdades.** Provedores de IA lista só as contas do Mac ("Para entrar, abra o app do nod no seu
  Mac"); Máquinas mostra chips "Claude Code pronto/sem login" da VM.
- **Conta da VM no limite não tem para onde ir.** O motor nunca produz `contaNoLimite` (`motor/main.ts:173`); o turno cai
  no limite por pessoa (`registrarLimite`, `assentar-turno.ts:303`).
- **Duas ordens que não se falam.** A ordem das IAs mora no servidor (`preferencias.ordem_ias`, 0068); a ordem das
  contas, no Mac (`contas.json`), separada por IA. Não dá para dizer "Claude · Pessoal, depois ChatGPT · Pessoal, depois
  Claude · Leapy".
- **Conectar a VM pede o Codex na instalação** (`NOD_COM_CODEX=1`) e o botão "Apareceu um código" é a pessoa dizendo
  que terminou.

Quem sente: o Marlon e o time que roda bots numa VM (hoje a `nod-motor-teste`) com mais de uma assinatura.

## Decisões (protótipo, 2026-10-13)

| # | Decisão | Quadros |
|---|---------|---------|
| Lista única | Uma lista de contas da pessoa, Claude e ChatGPT intercalados, uma ordem só. Cada linha: logo, "Provedor · apelido", plano, selo Corporativa, e-mail e organização (quando a máquina local sabe), as máquinas onde está logada. | CM1-A |
| 1A + 1B | As contas aparecem em Provedores de IA e no cartão de cada máquina; **tudo se gerencia em Provedores**. "Gerenciar contas" em Máquinas abre Provedores filtrado pela máquina. Renomear e desconectar a **máquina** ficam em Máquinas. | G1-*, G2-* |
| 2A | O login na VM é pela tela: o motor roda o login e manda o link/código; o código que o Claude devolve vai cifrado com a chave pública da VM, o servidor só repassa. Para o Claude há o terminal, escondido e mínimo. | CM2-A |
| 3A | A máquina manda ao servidor só uma impressão (hash) da conta; o servidor casa as contas iguais entre máquinas sem ver o e-mail. | CM3-A |
| Jornada | Comando de instalação com convite de uso único (sem digitar código); a tela vê a máquina chegar e pede para confirmar; o Codex sempre instalado. | CMJ-1, CMJ-2 |
| Dia a dia | Limite na VM: a pergunta da ADR-101 com as contas logadas nela e "Rodar no Mac desta vez"; conta livre só no Mac: "Entrar com ela na VM"; login vencido: entrar de novo ali, na conversa. | CMD-1..3 |

## Suposições tomadas sem o Marlon (ele pediu para seguir sem chamá-lo)

1. **Apelido e plano passam a morar no servidor** (emenda o item 3 da ADR-101). É o que permite a lista única no
   navegador, no celular e para contas que só existem na VM. E-mail e organização continuam só nas máquinas: aparecem na
   linha quando a tela roda dentro do app do Mac que conhece a conta. O apelido é um rótulo que a pessoa escreve; o
   plano vira o selo e decide a regra da conta corporativa.
2. **A conversa cita a conta pelo apelido** ("Claude · Leapy no limite até 14:00"), já que ele mora no servidor.
3. **Uma ordem só substitui a ordem das IAs da pessoa.** `preferencias.ordem_ias` continua existindo e é recalculada da
   lista (a ordem da primeira aparição de cada IA), para a ligação, o onboarding e a Inteligência do bot seguirem
   funcionando. A ordem própria do bot (2B) continua sendo de **IAs**: ela reordena as contas por IA, mantendo a ordem da
   pessoa dentro de cada IA.
4. **"Perguntar antes" vale só entre contas do mesmo provedor** (é a cláusula dos termos, ADR-101 §4). Passar de Claude
   para ChatGPT continua automático, como o Automático de hoje (`ia_trocada`).
5. **Um modo só** ("Perguntar antes" ou "Trocar sozinho") para a lista inteira; ao ligar "Trocar sozinho" o aviso mostra
   os termos dos dois provedores.
6. **O limite é da conta, não da máquina.** Conta no limite no Mac também está no limite na VM.
7. **Modo local (ADR-092, servidor no Mac)** fica como está (ADR-101). A lista única exige o modo compartilhado (o de
   produção desde 09/10); no modo local, `GET /contas-ia` responde `{ disponivel: false }` e a web mostra a tela de hoje.
8. **App do Mac antigo** (sem a ponte nova `contas.detalhes`): a web dentro dele mostra a tela de hoje com uma faixa
   "Atualize o app do nod para ver e gerenciar as contas de todas as máquinas". No navegador, a lista nova.
9. **Login pela tela só para a VM** (máquinas com o motor). O login no Mac continua o do app (navegador do próprio Mac).
   Fora do app do Mac, a caixa "Este Mac" fica desabilitada com "Abra o app do nod no Mac".
10. **Impressão da conta:** `sha256("nod-conta-v1\n" + pessoaId + "\n" + ia + "\n" + email em minúsculas + "\n" +
    (orgId ?? ""))`, calculada na máquina a partir do `claude auth status` (email, orgId) e do `account/read` do Codex
    (email). O servidor nunca recebe o e-mail; a mesma conta em duas pessoas dá hashes diferentes.

## Estado atual (verificado em 2026-10-13, `origin/main` 38514b57)

| Peça | Mac (app) | VM (motor) | Servidor |
|------|-----------|-----------|----------|
| Várias contas por IA | ✅ `desktop/contas-mac.ts`, `contas-no-app.ts` | ❌ uma pasta (`~nod/.claude`) | ❌ não conhece contas |
| Ordem | por IA, no `contas.json` | — | IAs: `preferencias.ordem_ias` |
| Conta escolhida por turno | `envPorDriver` global da IA (`desktop/main.ts:668`) | — | nada no plano (`PlanoTurno`) |
| Limite por conta | `contas-no-app.ts:198` `aoResultado` | ❌ | `ias_no_limite` por IA (0068) |
| Login | no app, navegador (`desktop/login-ia.ts`) | terminal (`motor/main.ts:337`) | — |
| Canal servidor → máquina | — | só puxadas: `puxar`, `esperas` (5 s), `itens-locais` | `rotas/ponte.ts` |
| Pareamento | ADR-069 (navegador) | código digitado (`pareamento-dispositivo.ts`) | em memória |
| Codex na instalação | — | só com `NOD_COM_CODEX=1` (`motor-instalacao.ts:108`) | — |

## O que muda

### 1. Banco (migração `0074_contas_ia.sql`, só adição)

```sql
CREATE TABLE contas_ia (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ia text NOT NULL,                       -- 'claude-cli' | 'codex-cli'
  impressao text NOT NULL,                -- sha256 hex (suposição 10)
  apelido text NOT NULL,
  plano text,                             -- legível: "Max", "Team", "Plus"…; null = a máquina não disse
  corporativa boolean NOT NULL DEFAULT false,
  posicao integer NOT NULL,               -- 1..n na lista da pessoa
  entra_na_troca_automatica boolean NOT NULL DEFAULT false,
  no_limite_ate timestamptz,
  removida_em timestamptz,                -- "Remover de todas": some da lista, as máquinas saem dela
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conta_ia CHECK (ia IN ('claude-cli', 'codex-cli')),
  CONSTRAINT conta_impressao CHECK (impressao ~ '^[0-9a-f]{64}$'),
  CONSTRAINT conta_apelido CHECK (char_length(apelido) BETWEEN 1 AND 40),
  CONSTRAINT conta_plano CHECK (plano IS NULL OR char_length(plano) <= 40),
  CONSTRAINT conta_posicao CHECK (posicao >= 1)
);
SELECT nod_escopar_tabela('contas_ia');
ALTER TABLE contas_ia ADD PRIMARY KEY (tenant_id, id);
CREATE UNIQUE INDEX contas_ia_por_impressao ON contas_ia (tenant_id, owner_id, ia, impressao);

CREATE TABLE contas_ia_maquinas (
  conta_id uuid NOT NULL,
  maquina_id uuid NOT NULL,               -- a chave da máquina (ADR-031); sem FK, como em 0066/0070
  estado text NOT NULL,                   -- 'pronta' | 'sem_login' | 'sem_acesso'
  sair_pedido_em timestamptz,             -- "Sair desta máquina": a máquina faz logout no próximo contato
  visto_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conta_maquina_estado CHECK (estado IN ('pronta', 'sem_login', 'sem_acesso'))
);
SELECT nod_escopar_tabela('contas_ia_maquinas');
ALTER TABLE contas_ia_maquinas ADD PRIMARY KEY (tenant_id, conta_id, maquina_id);
ALTER TABLE contas_ia_maquinas ADD FOREIGN KEY (tenant_id, conta_id) REFERENCES contas_ia (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE preferencias ADD COLUMN contas_modo text NOT NULL DEFAULT 'perguntar'
  CONSTRAINT preferencias_contas_modo CHECK (contas_modo IN ('perguntar', 'automatico'));
ALTER TABLE preferencias ADD COLUMN contas_escolhidas jsonb NOT NULL DEFAULT '{}'::jsonb;  -- { "claude-cli": "<conta id>" }
ALTER TABLE turnos ADD COLUMN conta_id uuid;  -- a conta que o plano mandou usar (sem FK: a conta pode ser removida)
ALTER TABLE maquina_tokens ...                -- nada: o nome já existe (renomear é UPDATE)
-- ROLLBACK: DROP das duas tabelas e das três colunas (o código anterior não as lê).
```

### 2. Contratos (`src/contracts/`)

- `contas-ia.ts` (novo):
  - `ContaAnunciada = { impressao: string; ia: IdHarness; estado: "pronta" | "sem_login" | "sem_acesso"; plano: string | null; corporativa: boolean; apelidoSugerido?: string }`.
  - `ContaIa = { id; ia; apelido; plano; corporativa; posicao; entraNaTrocaAutomatica; noLimiteAte: EpochMs | null; maquinas: { maquinaId; nome; estado }[] }`.
  - `ContasIaDto = { disponivel: boolean; modo: "perguntar" | "automatico"; contas: ContaIa[] }`.
  - `LoginNaMaquina` (fases `pedido → abrindo → aguardando_pessoa → conferindo → pronto | falhou | cancelado`, com `url`, `codigoDispositivo`, `pedeCodigo`, `chavePublica` (SPKI base64), `erro`, `contaId`).
- `ponte.ts`: o corpo de `conectar` e de `inventario` ganha `contas?: ContaAnunciada[]` (opcional: motor/app antigos não
  mandam; até 12 itens; validado em `ponte-validacao.ts` como os outros extras).
- `plano-turno.ts`: `PlanoTurno.conta?: { id: string; impressao: string; apelido: string }`.
- `mensagem.ts`: o payload `limite_do_plano` ganha `contas?: { de: ContaRef; livres: ContaLivre[]; maquina: { id; nome } | null }`,
  com `ContaLivre = { id; apelido; ia; naMaquina: boolean; outraMaquina: { id; nome } | null }`.
- `desktop.ts`: `PonteContas.detalhes(): Promise<{ impressao; email; organizacao; plano }[]>` (canal `nod:contas-detalhes`).

### 3. Domínio puro (`src/domain/contas-da-pessoa.ts`, novo)

- `impressaoDaConta({ pessoaId, ia, email, orgId })` → hex. (A máquina chama; fica no domínio para ter um só jeito.)
- `contaDoTurno({ contas, naMaquina, modo, escolhidas, iasDoBot, agora })` → `{ conta, ordemIas, iasSemConta } | null`:
  1. contas da pessoa em ordem, não removidas, `pronta` na máquina do turno;
  2. por IA, a conta em uso segue a ADR-101: a primeira da IA se livre; senão a escolhida se livre; senão, com
     `automatico`, a próxima livre que `entraNaTroca`; senão nenhuma;
  3. `ordemIas` = as IAs ordenadas pela posição da conta em uso de cada uma (a do bot, quando o bot tem ordem própria,
     manda; a IA fixa filtra);
  4. `iasSemConta` = IAs com contas registradas nesta máquina mas nenhuma utilizável agora (entram em `noLimite` do
     `escolherHarness`).
- `decidirLimiteDaConta({ contas, naMaquina, modo, conta, ate, agora })` → `{ tipo: "trocou", para } | { tipo:
  "outra_ia" } | { tipo: "perguntar", livres } | { tipo: "todas_no_limite", voltaEm }` (reusa `entraNaTroca`,
  `ehCorporativa` de `contas-da-ia.ts`).
- `reconciliarAnuncio(existentes, anunciadas, agora)` → inserções, atualizações de estado e vínculos a apagar.
- `ordemIasDaLista(contas)` → `IdHarness[]` (suposição 3).

### 4. Servidor

**Repositório** `src/repositories/contas-ia.repo.ts`: `listar`, `doAnuncio(maquinaId, anunciadas)` (upsert em
transação, posição = fim da lista para conta nova, apelido = sugerido ou "Conta N"), `renomear`, `reordenar(ids)`,
`marcarLimite(id, ate)`, `limparLimitesVencidos`, `pedirSaida(id, maquinaId | "todas")`, `remover(id)`,
`saidasPendentes(maquinaId)`, `confirmarSaida`.

**Rotas de sessão** (`src/adapters/http/rotas/contas-ia.ts`, novo):

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /contas-ia` | — | `ContasIaDto` |
| `PUT /contas-ia/ordem` | `{ ids: string[] }` (todas as não removidas) | 204; recalcula `preferencias.ordem_ias` |
| `PATCH /contas-ia/:id` | `{ apelido?, entraNaTrocaAutomatica? }` | `ContaIa` |
| `PUT /contas-ia/modo` | `{ modo }` | 204 |
| `POST /contas-ia/:id/sair` | `{ maquinaId }` | 202 |
| `DELETE /contas-ia/:id` | — | 202 (marca `removida_em` + saída em todas) |
| `POST /contas-ia/:id/seguir` | `{ conversaId }` | 202 (grava a escolhida da IA e refaz o último turno interrompido pelo limite) |
| `POST /maquinas/:id/logins` | `{ ia, contaId? , apelido? }` | `{ id }` |
| `GET /maquinas/:id/logins/:loginId` | — | `LoginNaMaquina` |
| `POST /maquinas/:id/logins/:loginId/codigo` | `{ cifrado: { chave, iv, dados } }` (base64, ≤ 8 KB) | 202 |
| `POST /maquinas/:id/logins/:loginId/cancelar` | — | 202 |
| `PATCH /maquinas/:id` | `{ nome }` (1–60) | `MaquinaDto` |
| `POST /maquinas/:id/desconectar` | `{ sairDasContas: boolean }` | 202 |
| `POST /maquinas/convites` | — | `{ convite, expiraEm }` (30 min, uso único) |
| `GET /maquinas/convites/:convite` | — | `{ pedido: { codigo, nome, plataforma, pedidoHaS } \| null }` |

**Rotas da máquina** (`rotas/ponte.ts`, chave de máquina):

- `POST /api/maquina/contas` (puxada a cada 3 s; 1 s com login aberto) → `{ logins: LoginPendente[], sair: string[] /*impressões*/, desconectar: boolean }`.
- `POST /api/maquina/contas/progresso` `{ loginId, fase, url?, codigoDispositivo?, pedeCodigo?, chavePublica?, erro?, impressao? }` → 204. O servidor recusa `url` fora de `LINKS_OFICIAIS` (`desktop/login-ia.ts:46`).
- `POST /api/maquina/contas/saiu` `{ impressoes }` → 204.
- `conectar` e `inventario` (já existentes) passam a gravar `contas` com `doAnuncio`.

**Logins em andamento**: `src/services/logins-na-maquina.ts`, em memória (como `pareamento-dispositivo.ts`): prazo de
15 min, no máximo 3 abertos por pessoa, o código cifrado é entregue uma vez e apagado. Reinício do servidor perde o
login aberto: a tela mostra "O login não terminou" com "Tentar de novo".

**Plano do turno** (`emitir-plano-turno.ts:150`): com contas registradas na máquina do turno, `contaDoTurno` dá a
`ordem` e o `noLimite` do `escolherHarness`, e a conta da IA escolhida vai em `plano.conta` e em `turnos.conta_id`.
Sem contas registradas (máquina antiga), nada muda.

**Pré-spawn** (`despachar-turno.ts:96`): com contas registradas e nenhuma utilizável, o turno não sai; vira a nota
`limite_do_plano` com as livres (sem gastar turno).

**Assentamento** (`assentar-turno.ts:299`): turno com `conta_id` que bateu no limite → `marcarLimite` →
`decidirLimiteDaConta`:
- `trocou` (modo automático) → refaz o turno (`aposTrocaDeConta`) com a nota "Seguindo com Claude · Leapy";
- `outra_ia` → caminho de hoje (`aposLimite`, `ia_trocada`);
- `perguntar` / `todas_no_limite` → nota com as livres. Não grava `ias_no_limite` (fica para turno sem conta).

### 5. Motor (VM)

- `src/adapters/executor/contas-locais.ts` (novo, sem Electron, usado pelo motor e pelo app): a lista local de pastas
  (`contas.json` em `pastaDoExecutor`), `prepararPastaDaConta`/`removerPastaDaConta` de `desktop/contas-mac.ts`
  (movidas para cá), `lerImpressao(dir)` (auth status/account read com a variável da conta),
  `anunciar()` → `ContaAnunciada[]` (cache de 60 s, refeito depois de login/logout), `instanciaDaConta(ia, impressao)`
  (cria e guarda um driver por conta com `envPorDriver`).
- `laco.ts:298`: com `plano.conta`, o driver vem de `instanciaDaConta`; conta que a máquina não tem mais → entrega
  `interrompido` com `motivoInterrupcao: "conta_ausente"` (o servidor apaga o vínculo e a tela mostra "Entrar").
- `motor/contas.ts` (novo): a puxada de `/api/maquina/contas`; o login roda `criarLoginDasIas` (`desktop/login-ia.ts`)
  numa pasta nova (`novoIdDeConta`) ou na da conta pedida; gera um par RSA-OAEP 2048 por login
  (`generateKeyPairSync`), manda a pública; recebe `{ chave, iv, dados }`, desembrulha a chave AES-GCM 256 e entrega o
  código ao CLI por `colarCodigo`. Sucesso → `lerImpressao` → progresso `pronto` com a impressão → novo anúncio.
- `sair`: `claude auth logout`/`codex logout` com a variável da conta e apaga a pasta (`removerPastaDaConta`).
- `desconectar`: sai das contas pedidas, confirma, apaga `conexao.json` e para (`exit 2`, não reinicia).
- Terminal (o caminho escondido do Claude): `nod-motor entrar claude [--conta <apelido|n>]` usa a mesma lista local;
  sem `--conta`, cria uma conta nova.
- A vigia sonda cada conta (não só a IA): uma IA nova na máquina vale sem reiniciar o serviço.

### 6. Instalação e pareamento

- `GET /api/motor/instalar?convite=<c>` embute `NOD_CONVITE` no script; o fim chama `nod-motor parear --convite <c>`.
- `pareamento-dispositivo.ts`: `pedir({ nome, plataforma, convite })` liga o pedido ao convite (uso único, 30 min, da
  pessoa que o criou). A web pergunta `GET /maquinas/convites/:c` a cada 2 s e mostra "A vm-bots apareceu. Conectar?";
  "Conectar" aprova com o `codigoPessoa` do pedido (rota de hoje).
- O Codex sempre instalado; `NOD_SEM_CODEX=1` desliga.
- Sem convite (comando antigo), o caminho de hoje (código digitado) continua.

### 7. App do Mac

- Anuncia as contas (`contas-locais.ts`) no `inventario` e aceita `plano.conta` como o motor.
- `contas-no-app.ts` deixa de decidir ordem, modo e escolhida quando o servidor manda a conta (continua para servidor
  antigo/modo local).
- Ponte nova `contas.detalhes()` para a web mostrar e-mail/organização das contas deste Mac (pela impressão).
- "Adicionar conta" no Mac = o fluxo de hoje (`comecarAdicao`), com o apelido indo como `apelidoSugerido`.

### 8. Web

- **Provedores de IA** (`web/telas/provedores.ts` reescrita; `web/telas/contas-lista.ts` nova): a lista única
  (CM1-A/G1-*): alça + posição + logo + "Provedor · apelido" + plano + Corporativa + e-mail/organização (se a ponte
  souber) + pílulas de máquina (logada ● / "Entrar na <máquina>" tracejada) + estado (Em uso / Disponível / No limite
  até HH:MM) + ⋯ (Renomear, Detalhes, Sair do <máquina> por máquina logada, Remover de todas). Arrastar reordena
  (`ordem-arrastavel.ts`). "Adicionar conta" (G1-P2): provedor, apelido, em quais máquinas entrar. O login de cada
  máquina abre na própria linha (G1-P3): Mac pelo fluxo do app; VM por `logins` (2A, com o código cifrado no
  navegador por WebCrypto e a linha discreta "Prefere o terminal? `nod-motor entrar claude --conta N`"). Filtro por
  máquina (G2-M2) por `?maquina=<id>` com "Voltar para Máquinas". "Quando uma conta bate no limite": Perguntar antes /
  Trocar sozinho (aviso dos termos de `aviso-termos.ts`, os dois provedores).
- **Máquinas** (G2-M1..M5): o cartão mostra as contas logadas (pilha de logos + nomes + "N contas suas ainda não estão
  aqui") e "Gerenciar contas ›"; ⋯ da máquina: Renomear (no cartão), Gerenciar contas, Bots desta máquina, Desconectar
  (modal com "Sair também das N contas de IA" marcado). Os chips "Claude Code pronto" saem do cartão.
- **Conectar uma máquina** (CMJ-1/2): passos Instalar (comando com convite, espera sozinha) → Confirmar → Contas (a
  lista da pessoa, "Entrar" por conta, como CM3-A) → Escolher os bots.
- **Conversa** (CMD-1..3, `web/telas/ia-fora.ts`): a nota do limite com "Seguir com <conta>", "Entrar com <conta> na
  <máquina>" (abre o login na própria conversa), "Rodar no <outra máquina> desta vez" (rota de hoje) e "Esperar até
  HH:MM"; a fila "a <vm> saiu da conta X" com "Entrar de novo" no lugar de "no terminal dela".

## Critérios de aceite

1. `GET /contas-ia` devolve as contas anunciadas por duas máquinas da mesma pessoa, e a mesma conta (mesmo e-mail e
   organização) logada nas duas aparece **uma vez**, com as duas máquinas em `maquinas`.
2. O servidor nunca recebe e-mail nem organização: `ContaAnunciada` não tem esses campos e o teste de contrato da ponte
   recusa um anúncio com campo extra.
3. `PUT /contas-ia/ordem` com `[C·Pessoal, G·Pessoal, C·Leapy]` faz o próximo turno de um bot "auto" sair com
   `plano.conta = C·Pessoal`; com C·Pessoal no limite, sai com G·Pessoal (troca de IA automática); com as duas no
   limite e modo "perguntar", o turno não sai e a conversa recebe a nota com "Seguir com Claude · Leapy".
4. Com modo "automatico" e C·Leapy corporativa sem `entraNaTrocaAutomatica`, o item 3 pergunta em vez de trocar.
5. Um turno da VM que bate no limite grava `contas_ia.no_limite_ate` e não grava `preferencias.ias_no_limite`.
6. "Seguir com <conta>" grava a escolhida da IA e refaz o turno interrompido sem a pessoa mandar a mensagem de novo.
7. Na VM, "Entrar" numa conta pela tela: o motor (rodando com um CLI falso de teste) recebe o pedido em ≤ 3 s, a tela
   mostra o link oficial e, para o Claude, o campo do código; o código colado chega ao CLI falso decifrado; o servidor
   guarda só o texto cifrado (teste lê o serviço e não acha o código em claro).
8. Um `url` de login fora de `LINKS_OFICIAIS` vindo da máquina é recusado (400) e a tela não o mostra.
9. "Sair da vm-bots" numa conta: no próximo contato a máquina roda o logout com a variável da conta, apaga a pasta e o
   vínculo some; a conta continua no Mac.
10. "Remover de todas": a conta some de `GET /contas-ia` na hora e cada máquina sai dela no próximo contato.
11. `curl …/motor?convite=X | sh` pareia sem digitar código: a tela mostra "<nome> apareceu. Conectar?" em ≤ 5 s
    depois do pedido; o convite não vale uma segunda vez (400) nem depois de 30 min.
12. O script de instalação instala o Codex sem `NOD_COM_CODEX`; com `NOD_SEM_CODEX=1`, não.
13. Uma conta logada na VM depois de o serviço subir aparece no anúncio sem reiniciar o `nod-motor` (≤ 60 s).
14. Renomear a máquina muda o nome em Máquinas, Provedores e nas notas da conversa.
15. Desconectar a máquina com "Sair também das contas" faz o motor sair das contas e parar; sem a caixa, só a chave é
    cancelada.
16. Modo local (`NOD_MODO` ≠ compartilhado): `GET /contas-ia` responde `{ disponivel: false }` e Provedores é a tela de
    hoje (testes de hoje de `provedores`/`contas-ia` passam sem mudança de comportamento).
17. `npm run check` verde; nada de `console.*`; migração com `-- ROLLBACK:` que desfaz.

## Plano de testes

| Camada | O quê | Qtde |
|---|---|---|
| Unit (domínio) | `contaDoTurno` (ordem intercalada, limite, escolhida, automático, corporativa, bot com IA fixa/ordem própria), `decidirLimiteDaConta`, `reconciliarAnuncio`, `ordemIasDaLista`, `impressaoDaConta` | +25 |
| Unit (serviço) | `logins-na-maquina` (prazo, 3 por pessoa, código entregue uma vez, cancelamento), convite no pareamento | +10 |
| Unit (motor) | puxada de contas, login com CLI falso + cifra RSA/AES ida e volta, sair, `entrar --conta`, script com convite e Codex | +12 |
| Unit (web) | lista única, ⋯, adicionar, filtro por máquina, cartão da máquina, modal de desconectar, notas da conversa, cifra no navegador (WebCrypto do Node) | +20 |
| Integração (withRollback) | `contas-ia.repo` (anúncio de duas máquinas casando, ordem, remover, sair) e RLS (outra pessoa não vê) | +8 |
| Concorrência | ponte HTTP: anúncio → `GET /contas-ia`; turno com `plano.conta`; limite → nota; login ponta a ponta com motor e CLI falsos | +4 |

## Rollback

Reverter o PR. A migração só adiciona (as tabelas e colunas novas ficam sem uso; o `-- ROLLBACK:` as tira). Um motor ou
app novo falando com um servidor antigo funciona: a validação da ponte ignora campo desconhecido no anúncio
(`ponte-validacao.ts:161`, "o anúncio é extra … nunca recusa o conectar"), e `/api/maquina/contas` que volta 404 desliga
a puxada de contas até o próximo `conectar`. Sem `plano.conta`, a máquina usa a pasta padrão, como hoje.

## Esforço

Domínio + contratos 3 h · banco + repositório 3 h · rotas/serviços 4 h · plano/pré-spawn/assentamento 4 h · motor 6 h ·
app do Mac 4 h · web 8 h · testes junto · QA 3 h. Total ~35 h de pessoa; algumas horas aqui.

## Arquivos

| Arquivo | Mudança |
|---|---|
| `src/db/migrations/0074_contas_ia.sql` | tabelas, colunas, rollback |
| `src/contracts/contas-ia.ts`, `inventario.ts`, `plano-turno.ts`, `mensagem.ts`, `desktop.ts`, `maquina.ts` | tipos novos |
| `src/domain/contas-da-pessoa.ts` | regras puras |
| `src/repositories/contas-ia.repo.ts` | repositório |
| `src/services/logins-na-maquina.ts`, `pareamento-dispositivo.ts` | login relay, convite |
| `src/adapters/http/rotas/contas-ia.ts`, `maquinas.ts`, `ponte.ts`, `motor.ts`, `compor.ts` | rotas |
| `src/adapters/http/motor-instalacao.ts` | convite, Codex sempre |
| `src/use-cases/emitir-plano-turno.ts:150`, `despachar-turno.ts:96`, `assentar-turno.ts:299` | conta do turno, limite |
| `src/adapters/executor/contas-locais.ts`, `laco.ts:298` | contas na máquina, driver por conta |
| `motor/main.ts`, `motor/contas.ts`, `motor/conexao.ts` | puxada, login, sair, convite |
| `desktop/main.ts`, `desktop/contas-no-app.ts`, `desktop/preload-web.ts` | anúncio, ponte `detalhes` |
| `web/telas/provedores.ts`, `contas-lista.ts`, `maquinas.ts`, `ia-fora.ts`, `conversa.ts`, `web/lib/*`, `web/main.ts`, `web/navegacao.css` | telas |
| `docs/adr/adr-102-*.md` | decisão |

## Fora do escopo

- Conta por bot (NOD-10) e compartilhar contas entre pessoas.
- Login pela tela no Mac vindo de outro aparelho (o Mac entra pelo próprio app).
- Modo local (ADR-092) com a lista única.
- Mostrar o e-mail de uma conta que só existe na VM (ficaria no servidor; a ADR-019 não deixa).
- O caminho B (o nod criar a VM).

## Relacionados

ADR-019, ADR-069, ADR-090, ADR-092, ADR-100, ADR-101 · NOD-209, NOD-211 · PR #286.
