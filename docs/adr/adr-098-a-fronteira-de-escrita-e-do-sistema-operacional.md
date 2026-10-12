# ADR-098 — A fronteira de escrita é do sistema operacional, não da leitura do shell

Status: **proposta** (experimento na VM antes de decidir) · Data: 2026-10-12 · Revê a decisão 1 da
[ADR-055](adr-055-terminal-de-verdade-como-o-inhouse.md) ("sem sandbox") só para a escrita · Substitui, se o experimento
passar, a cerca da [ADR-065](adr-065-o-bot-sabe-o-que-tem-e-cada-task-na-sua-pasta.md) (`gitForaDaPastaDoBot`)

## Contexto

Em 11/10 o Ze 1 teve "ferramenta Bash negada". Para entender por quê, as sessões dos bots foram varridas: 482
negações do hook do nod, 161 na VM (09/10 a 11/10) e 321 no Mac (28/09 a 09/10).

- 177 eram da cerca do git, que dizia "numa pasta que não deu para conferir". Em 167 delas, o comando dava valor à
  variável e a usava em seguida, como em `T=…; git worktree add "$T/x"`.
- O #258 ensinou a cerca a ler essas variáveis, e 144 das 177 passaram.
- As 33 que sobram são laço `for`, `cd` para variável de laço, `W=x git -C "$W"` e scripts em arquivo. Cada padrão
  novo vira mais um caso na cerca.

A cerca lê o shell como texto. Ela nunca fecha, porque o shell decide o caminho só na hora de rodar. Erra para os dois
lados:

- **Nega trabalho legítimo:** foram 167 casos.
- **Deixa passar o que devia negar:** até o #258, um `for …; do git -C <clone da pessoa> checkout main; done` passava
  sem conferência.

Pesquisa de 11/10, para ver como o mercado resolve:

- **ACP (Agent Client Protocol, da Zed):** não tem política. O agente decide quando pedir permissão
  (`session/request_permission`), e o cliente recebe a mesma string de shell que o hook do nod recebe hoje. Trocar o
  adaptador próprio pelo ACP não muda nada aqui. O desenho híbrido segue.
- **Claude Code:** tem sandbox do Bash aplicado pelo sistema operacional (Seatbelt no macOS, bubblewrap no Linux):
  - A escrita fica limitada ao cwd, às pastas de `--add-dir`, ao tmp do usuário e a `sandbox.filesystem.allowWrite`.
  - Quando o cwd é uma worktree, ele libera o `.git` compartilhado do repositório principal para o `git commit`, e
    mantém `hooks/` e `config` negados.
  - O limite vale para os processos filhos e é conferido na hora de gravar, então variável, laço e script em arquivo
    não escapam.
- **Codex:** o modo `workspace-write` (com `writable_roots`) faz o mesmo papel, com Seatbelt e Landlock.

A ADR-055 recusou o sandbox por causa da rede. O `gh` sem rede dizia "token inválido", e revisar um PR pedia três
cards. Isso continua valendo, e é o que o experimento precisa responder.

## Proposta

1. **Escrita pelo sistema operacional.** Nos turnos do Claude Code com terminal, o `--settings` passa a levar:
   - `sandbox.enabled: true`;
   - `allowUnsandboxedCommands: false`, para que o modelo não saia do sandbox com `dangerouslyDisableSandbox`;
   - `failIfUnavailable: true`, para que não rode sem sandbox em silêncio quando faltar bubblewrap.

   O cwd é a pasta da task (ADR-088). `allowWrite` recebe o `.git` dos clones da pasta do bot, onde o
   `git worktree add` grava, e os caches de ferramenta que os bots usam: `~/.npm`, `~/.cache`, `~/.local/share/pnpm` e o
   store do pnpm.
2. **Rede como hoje.** A regra `WebFetch(domain:*)` libera todo host HTTP(S) para os comandos do sandbox (CLI 2.1.186
   ou mais novo). O nod roda o `claude -p` com `--permission-mode default`, em que host fora da lista pediria
   confirmação, e no `-p` ninguém confirma.
3. **O que não passa pelo proxy:** no Linux, o `localhost` do comando é só dele. O Postgres de teste do host, o
   `docker` (socket Unix) e o `ssh` não alcançam a máquina. Duas saídas, escolhidas no experimento:
   - `excludedCommands` estreitos (`docker compose *` e os scripts de teste que sobem Postgres);
   - `network.allowAllUnixSockets` para o socket do Docker.
4. **O nod continua decidindo** o que é produto: aprovação na conversa (ADR-055 §4), "o resto desta tarefa", a regra
   de credencial, a espera com sleep (ADR-089) e a trilha. O que sai é a cerca de caminho (`gitForaDaPastaDoBot`), que
   fica só como mensagem que ensina o caminho certo, sem negar.
5. **Codex:** `workspace-write` com `writable_roots` equivalentes, numa etapa seguinte.

## Experimento (fase 0, só na VM)

A VM `nod-motor-teste` é o lugar certo. Só bots trabalham nela, e os clones (`~/nod/<bot>/gamefik`) são dos próprios
bots, então um erro de fronteira não estraga trabalho de pessoa.

- **Preparação:** instalar `bubblewrap` e `socat` (Debian 12) e conferir no `/sandbox` que as dependências estão
  presentes.
- **Escopo:** ligar o sandbox para um bot só (o Ze 1, que mais tropeçou na cerca) atrás de uma variável do motor, e
  deixar rodar um dia de trabalho normal.
- **Comandos que precisam passar:**
  - `git fetch`, `git worktree add`, `git commit` e `git push` por HTTPS com o `gh`;
  - `gh pr checks`/`view`/`create`;
  - `pnpm install --frozen-lockfile`;
  - a suíte do gamefik com Postgres embutido;
  - `docker compose up` do banco de teste;
  - o Playwright.
- **O que medir:**
  - as falhas por rede (o proxy nomeia o host negado no resultado);
  - as falhas por escrita ("Operation not permitted" fora da task);
  - o tempo dos comandos, comparado com o dia anterior;
  - quantas negações da cerca deixariam de existir.

## Alternativas consideradas

- **Só melhorar a cerca** (o que o #258 fez): resolve 81% hoje e continua lendo shell como texto. Fica como camada de
  mensagem, não de segurança.
- **ACP no lugar dos adaptadores próprios:** não tem política. Pesquisado em 11/10.
- **Contêiner por task:** isolamento mais forte, mas cada task precisaria do próprio Postgres, das credenciais e dos
  caches, e o custo de disco e de memória já apertou a VM (ADR-096; memória em 11/10).

## Riscos

- **O sandbox quebra ferramenta que hoje funciona.** Esse é o motivo da ADR-055. O experimento é num bot e numa máquina
  só, com volta por uma variável.
- **macOS:** o Seatbelt e o Keychain do `gh` foram a dor original. O Mac só entra depois que a VM passar, e com o mesmo
  experimento.
- **Versão do CLI:** o bare `*` pede 2.1.186 ou mais novo, e o sandbox de comando do Monitor também tem piso. A régua de
  pisos (`flag-floors.ts`) ganha a linha.

## Gatilho de reversão

- No experimento, mais de 3 comandos de trabalho normal por dia que só passam fora do sandbox (e não cabem num
  `excludedCommands` estreito): o sandbox não serve para os bots, e a cerca melhorada (#258) fica.
- Qualquer "token inválido" ou "rede bloqueada" que o bot tome como fato, o sintoma da ADR-055: voltar na hora.
