# ADR-089 — Ciclo de vida dos processos: órfãos no religar, hook que solta, laço de sleep

Status: aceito · Data: 2026-10-09 · Issue #217, parte do épico #221 (performance no Mac). Emenda a
[ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) (grupos de processo) e a
[ADR-055](adr-055-terminal-de-verdade-como-o-inhouse.md) (o hook do terminal); conversa com a
[ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md) (sem teto de tempo) e a
[ADR-086](adr-086-esperar-fora-do-mac.md) (`me_chame_as`).

## Contexto

Em 09/10 o Mac do Marlon parou com load ~430 e o swap cheio. Entre o que segurava memória sem trabalho:

- dois `claude -p` **órfãos (pai = 1) vivos havia 7h30**, de um servidor religado às 21:40Z de 08/10. Um rodava
  `while :; do gh run list …; sleep 30; done` (Cecília esperando o CI), o outro laços com `sleep 10/15`. O resultado não
  chegava a ninguém, e a task retomada (ADR-084) passava a ter dois processos na mesma pasta;
- o hook do terminal, numa espera de aprovação que o servidor já tinha soltado (`soltar: true`, Mac apertado),
  repetindo a consulta sem pausa por até 7 min.

As causas: o `exit` do Node (que mata os grupos `detached`, ADR-083) não roda num SIGKILL, numa queda ou num SIGHUP sem
ouvinte — os religamentos de 08/10 às 15:42Z, 17:07Z e 21:40Z não têm `sinal_recebido` no log; o `dev.mjs` só sinalizava
a ponta (`npx`/`mise`); o hook só olhava `estado === "decidida"`; e nada impedia o bot de esperar com `sleep` no próprio
terminal, o que mantém a sessão viva (`emFundo.size > 0` segura a entrada do CLI aberta).

Decisão do Marlon que vale aqui: **sem teto de tempo** para sessão ou comando longo (ADR-067). Ataca-se o desperdício
(órfão, laço apertado, laço de `sleep`), nunca o trabalho demorado de verdade.

## Decisão

1. **Grupos anotados em arquivo, e o boot mata as sobras** (`executor/grupos-orfaos.ts`, `processo.ts`).
   - Cada grupo vivo fica num JSON da instância, gravado de forma síncrona a cada spawn e fim: o pid do líder, o relógio
     antes e depois do spawn e o nome do binário. O arquivo também anota o dono (pid e início do processo do nod).
   - **Um arquivo por instância.** O servidor usa `~/.nod/grupos-vivos/servidor-<hash de DATABASE_URL|porta>.json`: o
     diário e uma instância temporária de teste no mesmo Mac não se matam. O app do Mac usa
     `<userData>/executor/grupos-vivos.json` (uma cópia por pessoa, pelo `requestSingleInstanceLock`).
   - **No boot**, antes de qualquer turno, um `ps -A` (com `LC_ALL=C`, porque no Mac em português o `lstart` sai
     "Sex  9 Out") e SIGKILL no grupo só quando: o líder está vivo, ainda é líder do grupo, nasceu entre os dois relógios
     do spawn e roda o binário anotado. Um pid reaproveitado falha no início e não é tocado. Se o líder já morreu e o
     grupo tem membros (o `claude` saiu e deixou o `while … sleep` do Bash), eles são os nossos: o sistema não dá a um
     processo novo um pid que ainda é número de grupo — e todos precisam ter nascido depois do spawn. Cada grupo morto
     vira `orfao_encerrado` no log.
   - Dono anotado ainda vivo (outra cópia da mesma instância, que o `listen` vai recusar): nada é morto e o arquivo fica
     com ele. Sem `ps` (imagem mínima), nada é morto e fica `orfaos_sem_ps`.
   - Fim normal: o `exit` (servidor) e o `will-quit` (app) matam os grupos e anotam a lista vazia.
2. **Sinais pelo mesmo caminho.** O servidor trata SIGHUP como SIGINT/SIGTERM (drenagem; o segundo sai com 130, pelo
   `exit`). O mesmo sinal repetido em menos de 3 s é eco de quem repassou (dev.mjs, npm, tsx) e não conta como segundo.
   O `dev.mjs` repassa SIGINT/SIGTERM/SIGHUP a toda a árvore dos dois filhos no mesmo grupo (os bots, em grupo próprio,
   ficam com o `exit` do servidor).
3. **O hook respeita `soltar`.** `soltar: true` encerra a espera na hora com `AINDA_ESPERANDO`, como o proxy já fazia
   nas ferramentas MCP: o turno acaba e a decisão volta como retomada. Entre duas consultas passa ao menos 1 s, para
   nunca haver laço apertado mesmo quando a rota responde na hora.
4. **O laço de espera é negado** (`domain/espera-em-laco.ts`, na rota `/interno/nativas` que o hook chama). Bash e
   Monitor com `while`/`until` que têm `sleep` dentro, ou `sleep` acima de 60 s, voltam negados. A mensagem aponta o
   `me_chame_as` quando ele está no catálogo do turno; sem ele (sala, ligação), manda encerrar dizendo o que falta. Fica
   `espera_em_laco_negada` no log (o tipo e os segundos, nunca o comando). A leitura é de shell: aspas, comentários e
   corpo de heredoc são dados; `$(…)`, crase, `bash -c`, `eval` e `bash <<EOF` entram. `sleep 2 && curl`, o `for` com
   fim e todo comando longo de verdade (testes, build, `npm ci`, `docker compose up`) seguem livres, sem teto.

## Por que no servidor e não no hook

A regra 4 mora na rota que o hook já chama a cada comando, e não no `decidirNativa` local: o servidor tem o catálogo do
turno (sabe se há `me_chame_as`), o log fica no lugar de sempre e a regra vale para os Macs com o app atual sem esperar
uma versão nova. O hook só repassa a negação, como faz com toda resposta não-OK.

## Alternativas rejeitadas

- **Teto de tempo por comando ou sessão.** Contra a decisão do Marlon (ADR-067): mata o trabalho legítimo junto.
- **Tabela no banco para os grupos.** O app do Mac não tem banco, e o registro precisa ser gravado no `exit`, que só
  aceita trabalho síncrono.
- **Matar por nome (`pkill claude`).** Mataria o Claude Code da própria pessoa e os bots de outra instância.
- **Conferir o pid só pelo nome do comando.** Um `claude` novo da pessoa pode herdar o pid; o início do processo é o
  que distingue.
- **Filhos do `dev.mjs` em grupo próprio (`detached`).** O Vite em segundo plano pararia ao ler o terminal (SIGTTIN), e o
  SIGKILL no grupo de um bot que rodou o `dev.mjs` deixaria o servidor e o Vite para trás.

## Limitações conhecidas

- O Codex não passa pelo hook (`approval_policy="never"` no sandbox dele): a regra 4 só vale para o harness com o hook.
- O laço escondido num script em arquivo (`bash espera.sh`) não é lido. Guarda contra o hábito, não contra quem esconde.
- O `for` com `sleep` longo dentro passa se cada `sleep` tiver até 60 s.
- Um SIGKILL no próprio `dev.mjs` ainda deixa o servidor vivo (sem órfão de bot: o servidor segue dono deles).
- O hook novo (regra 3) chega ao Mac com a próxima versão do app; a regra 4 vale já no deploy do servidor.

## Gatilho de reversão

- `orfao_encerrado` em boot depois de um religamento limpo (com `sinal_recebido`): o registro está deixando grupo para
  trás no fim normal — rever `soltarGrupo`.
- Uma pessoa relata um processo dela (fora do nod) morto no boot: rever a conferência de identidade antes de qualquer
  outra coisa.
- `espera_em_laco_negada` seguida de o bot desistir de um comando legítimo (testes, build) no mesmo turno: a leitura
  tem falso positivo — corrigir o caso e pôr no teste.
