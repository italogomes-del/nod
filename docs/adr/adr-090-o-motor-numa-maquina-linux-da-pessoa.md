# ADR-090 — O motor numa máquina Linux da pessoa: "traga sua VM"

**Status** aceito · decidido e implementado em 2026-10-09 (decisões do Marlon na conversa de estudo; aula em
https://claude.ai/artifact/9s7Evq2HLyixCeMncVSnaV) · plano em [docs/plano-motor-na-vm.md](../plano-motor-na-vm.md)

Estende a ADR-021 (ponte), ADR-022 (localidade) e ADR-069 (pareamento). Emenda a ADR-020 (o app do Mac deixa de ser
obrigatório quando há outro motor) e a ADR-045 (a queda é da máquina, não só do Mac). Confirma a ADR-028 e a pré-ADR-030.

## Contexto

O Mac de quem usa o nod é o motor de todo turno: o laço do executor, o `claude -p`/`codex`, o proxy MCP, o hook das
nativas e o `gh` rodam dentro do app Electron (`desktop/main.ts`). Medido no diário (ADR-085): p50 de 3 turnos ao mesmo
tempo, p90 de 7, máximo de 23; ~300 MB por `claude -p`; em 06/10 a carga chegou a 22 por núcleo, puxada pelos comandos
que os bots disparam. E o Mac dorme: 43 retomadas em 7 dias de rotinas cortadas de madrugada (ADR-045).

Quem tem uma máquina sempre ligada quer que os bots trabalhem nela, sem ocupar o Mac. O desenho já permite: o servidor
nunca disca para a máquina (ADR-021), então uma VM só precisa de saída HTTPS; e duas máquinas da mesma pessoa já são
previstas (`reivindicar` com `SKIP LOCKED`, `machine_id` em `turnos`). Falta o motor rodar sem Electron, a VM se
parear sem navegador, uma regra de qual máquina pega cada turno e os textos que hoje dizem "Mac" em todo lugar.

## Decisão

1. **Uma máquina Linux da pessoa é uma máquina como o Mac.** O motor que roda nela é o mesmo código
   (`src/adapters/executor/*`, `src/adapters/mcp-proxy/*`, `src/adapters/conectores-locais/*`), com um ponto de entrada
   Node sem Electron. Mesma ponte (`/api/maquina/*`), mesma chave escopada (ADR-031), mesma versão mínima (ADR-020).
   Uma chave por máquina: o id da chave continua sendo a identidade da máquina.
2. **Híbrido.** O Mac (ou qualquer navegador) é a janela; a máquina escolhida é o motor. O app do Mac continua sendo o
   jeito padrão de usar o nod, mas, com outro motor conectado, a web sozinha funciona (emenda a ADR-020: "sem ele não
   há executor" passa a valer só quando nenhuma outra máquina está conectada).
3. **Pareamento por código, sem navegador na máquina** (estende a ADR-069). A máquina pede um código curto ao
   servidor e mostra no terminal; a pessoa digita o código na web (com sessão) e confirma "Conectar <nome>?"; a
   máquina, que pergunta em intervalos, recebe a chave nascida em `emitirChaveMaquina` no escopo de quem confirmou. É o
   fluxo de dispositivo da RFC 8628. Pedido em memória, uso único, prazo curto, limite de tentativas, como o da ADR-069.
4. **A credencial do CLI é logada pela pessoa, na máquina dela.** O nod mostra o comando (`claude` / `codex login`
   / `gh auth login`) e a vigia das IAs percebe quando ficou pronto, perguntando ao CLI (ADR-019). O nod nunca lê,
   recebe, guarda ou repassa o login. O Marlon conferiu os termos de uso em 2026-10-09: com o login feito pela própria
   pessoa na máquina dela, o uso está coberto.
5. **Cada bot tem onde trabalha** (estende a ADR-022). "Qualquer máquina" (o comportamento de hoje) ou uma máquina
   escolhida, com um padrão por pessoa. A regra é declarativa e decidida no `reivindicar`; o agente não escolhe e não
   tem ferramenta para trocar.
6. **Máquina escolhida fora do ar.**
   - **Conversa, task ou pedido de colega que ainda não começou:** espera na fila. A tela diz "esperando <máquina>
     (sem contato desde HH:MM)" e oferece "Rodar em <outra máquina> desta vez", que é ato da pessoa e vale só para
     aquele turno.
   - **Rotina:** não muda de máquina. Fora do ar na janela, a execução fica `interrompida` com o aviso único da
     ADR-045, generalizado de "seu Mac" para "<máquina>".
   - **Turno que já tinha começado:** como hoje (ADR-045). Não migra: turno não é idempotente e a credencial mudaria
     no meio.
7. **Os arquivos ficam onde o bot trabalha.** A pasta do bot é `~/nod/<bot>` na máquina que roda o turno (como já é,
   `claude-cli.ts`). Não há sincronização com o Mac. Anexos já chegam por `/api/interno/anexos/:id` e funcionam em
   qualquer máquina; o arquivo do Mac para um app (ADR-068) já não vale no modo compartilhado e continua assim.
8. **A máquina diz o que é.** O anúncio (`AnuncioMaquina`) ganha `plataforma` (`darwin` | `linux`). O prompt de
   sistema, "Sua vez", os avisos e as telas usam o nome e o tipo da máquina do turno, e deixam de afirmar "Mac" quando
   não é. O bot numa VM não ouve que tem Finder nem as credenciais do Mac da pessoa.
9. **O uso da máquina vale fora do macOS** (estende a ADR-085). O amostrador lê memória e processador também no Linux,
   para "segurar trabalho novo em segundo plano" valer na VM.
10. **Computadores dos bots (ADR-037) ficam fora.** A feature não está em uso. As opções estão documentadas no plano,
    sem implementação.

## Por que não fere a ADR-028 nem a pré-ADR-030

A ADR-028 proíbe o turno de executar fora da máquina onde roda o proxy MCP, porque Sua vez, aprovação tipada e
`pedir_a_pessoa` param de valer em silêncio. Aqui o proxy, o CLI, o hook e o login vão juntos para a VM: o turno nunca
sai da máquina do proxy. O caminho de volta é o de sempre, pelo servidor: `pedir_a_pessoa` e `pedir_aprovacao` chegam à
pessoa e voltam ao turno. O critério mecânico da pré-ADR-030 continua valendo e vira teste de aceite (ver o plano).

O que a ADR-028 temia, "uma segunda cópia da credencial fora do servidor", não acontece: a VM é da pessoa, e a
credencial é logada por ela, como no Mac. A VM não é o "computador do bot" (ADR-037), que é de outra natureza.

## Alternativas rejeitadas

- **App inteiro na VM por área de trabalho remota.** Tela atrasada, microfone ruim e joga fora a web, que já existe.
- **O servidor do nod alcançar a VM (SSH, túnel, porta aberta).** Contraria a ADR-021 sem ganho: a VM puxa como o Mac.
- **Pareamento colando a chave de "Chaves" num arquivo.** Funciona hoje e fica como saída manual, mas é o passo que a
  ADR-069 tirou do Mac por pedir que a pessoa entenda o modelo.
- **Passar o turno para outra máquina sozinho quando a escolhida cai.** Proibido pela ADR-022.
- **Sincronizar a pasta do bot entre VM e Mac.** Decidido em 2026-10-09: os arquivos ficam onde o bot trabalha.
- **O nod hospedar as máquinas (caminho C).** Fora: isolamento entre pessoas por microVM, operação 24 h e a credencial
  da pessoa na infraestrutura do nod. O caminho B (o nod cria a VM na conta da pessoa) vem depois, sobre o mesmo motor.

## Gatilho de reversão

- **Login.** Se, em 14 dias com pelo menos uma VM conectada, ela passar mais de 10% do tempo conectada sem nenhuma IA
  pronta no anúncio (`harnesses` sem `pronto`: login expirado ou ausente), o login feito pela pessoa no terminal não é
  viável como fluxo: reabrir o item 4 (login guiado pela tela, sempre sem o nod tocar a credencial).
- **Regra de onde trabalha.** Se mais de 1 em cada 5 turnos de conversa de bots presos a uma máquina esperar mais de
  10 min por ela fora do ar, a espera é pior que a migração: reabrir o item 6 só para turno que não começou.
- **Promessa de aliviar o Mac.** Se, com todos os bots presos à VM, o diário ainda registrar `fundo_segurado` no Mac em
  mais de 5% dos dias, o peso não era o motor: medir o que sobrou antes de seguir para o caminho B.

## Implementação (2026-10-09)

- **Motor sem janela:** `motor/main.ts` (comandos `parear`, `entrar`, `estado`, `rodar`) e `motor/conexao.ts` (chave em
  arquivo 0600). Reusa o laço, os drivers, a vigia das IAs e o proxy do app do Mac. `scripts/motor/build.mjs` empacota
  em `dist/motor`, que vai na imagem do servidor.
- **Instalação:** `curl -fsSL https://<nod>/motor | sh` (`/motor` redireciona para `/api/motor/instalar`;
  `src/adapters/http/motor-instalacao.ts`). Node fixo, usuário `nod`, Claude Code (Codex com `NOD_COM_CODEX=1`), gh,
  serviço `nod-motor` no systemd e o pareamento no fim. Rodar de novo atualiza.
- **Pareamento por código:** `src/services/pareamento-dispositivo.ts` e as rotas `pareamento/dispositivo[/trocar]` e
  `maquinas/dispositivos/:codigo[/aprovar]`.
- **Onde o bot trabalha:** migração 0066 (`agentes.maquina_id`, `preferencias.maquina_padrao_id`,
  `turnos.maquina_desta_vez`), filtro no `reivindicar` e as rotas `maquinas`, `maquinas/padrao`, `maquinas/:id/bots`,
  `agentes/:id/maquina` e `conversas/:id/rodar-desta-vez`.
- **Prompt:** `plataforma` no anúncio e `maquina` no plano; `terminalNaMaquinaLinux` em `prompt-sistema.ts`.
- **Uso da máquina:** o amostrador lê `/proc/meminfo` e a carga no Linux, só no motor (`lerNoLinux`).
- **Web:** Seu espaço › Máquinas (`web/telas/maquinas.ts`), o "Conectar uma máquina" em 5 passos, o link
  `?parear-maquina=<código>` e a fila da conversa com a máquina fora do ar (protótipo 4c).

Ainda não implementado: juntar "Este Mac" em "Máquinas", o timer de atualização do motor, a rotina com a máquina fora
do ar ganhar o aviso único (hoje ela espera e vence pela regra de sempre), o caminho B e os computadores dos bots.
