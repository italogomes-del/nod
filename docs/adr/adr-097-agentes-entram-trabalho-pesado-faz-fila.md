# ADR-097 — Agentes entram, trabalho pesado faz fila

Status: proposta · Data: 2026-10-11 · Emenda a [ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md) (o portão que
segura trabalho novo) e a [ADR-091](adr-091-regua-do-processador-cpu-e-fila.md) (a régua do processador). Plano de
entrega em [plano-agentes-e-trabalho-pesado.md](../plano-agentes-e-trabalho-pesado.md); telas em
[prototipos/agentes-e-trabalho-pesado](../prototipos/agentes-e-trabalho-pesado/README.md).

## Contexto

Em 11/10 o Marlon viu "processador cheio (91%)" com só 3 bots trabalhando na `nod-motor-teste` (e2-highcpu-8: 8 vCPU,
8 GB, sem swap), a VM que ele tinha aumentado justamente para rodar mais coisas em paralelo. A expectativa dele, e a de
quem vai usar o nod: uma máquina de 8 núcleos e 8 GB roda pelo menos uma dezena de agentes ou tasks ao mesmo tempo, e
não só tasks de código (operacionais, vídeo, imagem, ferramentas, análise de dados).

Medido na VM às 13:38 UTC (amostra de 30 s por `/proc/*/stat`, agrupada pela pasta da task):

- Cada `claude -p` gastava de 3% a 6% de um núcleo e ~300 MB (290 a 340 MB). O agente passa quase todo o tempo
  esperando o modelo.
- O peso vinha dos comandos que os bots rodavam: testes de integração do gamefik com um Postgres embutido por arquivo
  (96% num único Postgres), o vitest do nod (um processo por núcleo) e `tsc --noEmit` (1,6 núcleo, ~1 GB). Cada
  ferramenta usa todos os núcleos que vê, então uma suíte sozinha já enche a máquina.
- Memória: 5,4 GB usados e 2,5 GB disponíveis. A tela dizia "os bots usam 925 MB" porque conta só o processo do Claude.
- Dois Postgres de tasks antigas do Eng 1 continuavam de pé (pai = init).

No `mac_leitura` (a cada 5 min) a VM ficou quase o dia todo perto de 0%, com rajadas às 04:07, 05:37 e 13:23–13:38
UTC. A régua da ADR-091 lê ~30 s, e o portão (`fundo_segurado`, motivo processador) segurou trabalho novo de 30 s a
2,5 min por vez nessas rajadas. A memória piscou amarela às 13:37 e fez a tela de Trabalhos mostrar "pouca memória",
enquanto o cartão da máquina dizia "memória folgada".

O problema não é o tamanho da máquina. O portão trata o agente e o trabalho pesado como a mesma coisa: barra a entrada
de um agente novo, que custaria 5% de um núcleo, porque um comando de outro agente encheu o processador por um
minuto. E numa máquina maior a porcentagem de pico não cai, porque os testes abrem um processo por núcleo; só dura menos.

## Decisão

Separar o agente do trabalho pesado que ele dispara. **Agentes entram pela memória; comando pesado faz fila; a máquina
é repartida entre as tasks.** O usuário não precisa saber o que é núcleo, swap ou cgroup.

1. **Medir a task inteira.** O consumo de uma task passa a ser o do agente mais tudo o que ele abriu (a árvore de
   processos no Mac, o grupo da task na VM). É o número da tela e o que o portão usa. As telas passam a ler a mesma
   leitura, sem uma dizer "folgada" e outra "pouca memória".
2. **O processador deixa de barrar a entrada.** Processador cheio deixa tudo mais lento, não derruba nada. A régua da
   ADR-091 continua, olhando o uso sustentado (minutos, não 30 s), e serve à tela e à fila do item 3. Memória e disco
   continuam segurando trabalho novo como hoje (ADR-085, ADR-096).
3. **Agente entra se cabe na memória.** Cabe mais um agente se, tirando ~400 MB para ele, sobra a reserva dos comandos
   pesados. Na VM de 8 GB isso dá 10 a 12 agentes ao mesmo tempo. O que a pessoa pede na conversa continua começando
   sempre (ADR-085).
4. **Fila do forno para comandos pesados.** O hook que o nod já põe antes de cada comando de terminal do bot
   (`PreToolUse`, `claude-cli.ts`) passa a pedir uma vaga à máquina. Sem folga, o comando espera em ordem e o resto
   segue: os outros agentes conversam, chamam ferramentas e esperam o modelo normalmente. O nod não adivinha o que é
   pesado pelo nome do comando: mede o pico de memória de cada comando por task e repositório e reserva esse tanto da
   próxima vez; o que nunca passou de pouco (git, ls, leitura de arquivo) não espera. Na VM de 8 GB cabem 2 a 3
   comandos pesados por vez; com 32 GB, uns 8.
5. **Repartir a máquina entre as tasks.** Na VM (Linux), cada task roda no seu grupo de controle (cgroup v2, por
   `systemd-run --scope` do motor) com peso de processador e limite de memória: quatro suítes ao mesmo tempo ficam mais
   lentas, nenhuma derruba as outras, e a task que estoura cai sozinha. O processo do agente tem peso maior que os
   comandos dele, para a conversa seguir respondendo. No Mac, que não tem cgroup, os comandos de fundo rodam com
   prioridade baixa (`taskpolicy -c utility`, como a limpeza da ADR-096). O instalador do motor liga swap comprimido
   (zram) na VM, para um pico de memória ficar lento em vez de travar.
6. **Bots econômicos.** As instruções do nod pedem ao bot que, durante o trabalho, rode só os testes do que mexeu, e a
   suíte completa uma vez antes do PR. Vale para todo usuário e diminui a fila do item 4.
7. **Task terminada encerra o que abriu.** O motor encerra o grupo inteiro da task (Postgres, servidores de teste,
   observadores) quando o turno acaba e ela não pediu para manter nada de pé.
8. **Falar com o usuário em linguagem simples.** A tela separa "trabalhando" de "esperando a vez de rodar os testes".
   Com o tempo de fila medido, o nod recomenda máquina ("hoje seus bots esperaram 40 min na fila; com 32 GB caberiam
   ~8 comandos por vez").

### O que é do nod e o que é do usuário

É do nod tudo que exige conhecimento técnico ou se repetiria igual para cada usuário: medir, dividir a máquina,
enfileirar, limpar, ensinar o bot a economizar e explicar. É do usuário o que é escolha de dinheiro, prioridade ou do
próprio projeto: o tamanho da máquina, o quanto dela dá para os bots (opção que já existe), quantos bots e rotinas põe
na mesma máquina, e o peso do próprio projeto (como os testes do gamefik com um Postgres por arquivo). O nod aponta; o
usuário decide e, se quiser, pede a um bot para otimizar.

## Consequências

- O número de agentes ao mesmo tempo passa a ser limitado pela memória, não pelo primeiro pico de teste. Na VM de
  11/10, de ~3 a 4 para 10 a 12 (estimativa; a fase 0 do plano mede antes de calibrar).
- Comando pesado pode esperar. A tela precisa mostrar isso, ou o bot parece parado.
- A fila do item 4 cobre o Claude Code, que tem o hook. O Codex fica protegido pelo grupo da task (item 5), sem fila,
  até ter um ponto equivalente.
- Mais estado no motor: grupo por task, histórico de pico por comando, swap. No Mac só a prioridade baixa e a medição.
- Pontos a validar com o Marlon: a reserva por agente (~400 MB), o quanto guardar para comandos pesados, a janela da
  régua sustentada e se a fila respeita a ordem de chegada ou a prioridade (o que a pessoa pediu passa na frente).
