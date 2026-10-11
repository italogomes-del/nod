# Plano: agentes entram, trabalho pesado faz fila

> Proposto em 2026-10-11, a partir do diagnóstico da `nod-motor-teste` ("91% de processador com 3 bots"). Decisão em
> [ADR-097](adr/adr-097-agentes-entram-trabalho-pesado-faz-fila.md); telas em
> [prototipos/agentes-e-trabalho-pesado](prototipos/agentes-e-trabalho-pesado/README.md).

## Objetivo

Uma máquina de 8 núcleos e 8 GB roda uma dezena de agentes ao mesmo tempo, em qualquer tipo de task (código,
operação, vídeo, imagem, ferramentas, análise de dados), sem que o usuário precise entender de processador.

## O princípio

Agentes custam pouco e entram à vontade. Comando pesado faz fila. O usuário decide dinheiro, prioridade e o próprio
projeto.

| | Processador | Memória |
|---|---|---|
| Um agente pensando, conversando ou chamando ferramentas | 3% a 6% de um núcleo | ~300 MB |
| Um comando pesado (suíte de testes, typecheck, Postgres, vídeo) | todos os núcleos que encontrar | 0,5 a 1,5 GB |

Os agentes são os garçons; o comando pesado é o forno. Hoje o nod fecha a porta do restaurante quando o forno enche. O
certo é deixar os garçons trabalharem e fazer fila só no forno.

## Responsabilidade do nod

1. **Medir certo.** Consumo da task inteira (agente + o que abriu); registro por task para calibrar; a régua do
   processador olha uso sustentado e deixa de barrar a entrada; as telas leem a mesma leitura.
2. **Deixar entrar pela memória.** Cabe mais um agente se sobram ~400 MB além da reserva dos comandos pesados. Na VM
   de 8 GB, 10 a 12 agentes.
3. **Fila do forno.** O hook reescreve o comando para `nod-vaga -- <comando>`, e a espera acontece dentro do terminal
   do bot, que não tem prazo, como a ficha do jobserver do GNU make. Pesado = o maior pico de memória das últimas 5
   execuções daquele comando, naquela task e repositório, mais 15%, aumentando depois de faltar memória. Sem folga,
   espera; o resto segue. Nada espera para sempre: sem pesado rodando, o próximo roda. Quantos por vez é o que cabe.
4. **Repartir a máquina.** VM: grupo por task (cgroup v2) com peso de processador (sem teto) e teto duro de memória
   alto (a máquina menos a reserva), agente com peso maior que os comandos. Unidade do motor com `Delegate=yes` e
   `OOMPolicy=continue`; swap comprimido (zram) no instalador. Mac: prioridade baixa para comando de fundo.
5. **Bots econômicos.** Testes do que mexeu durante o trabalho; suíte completa uma vez antes do PR.
6. **Limpar o que abriu.** Task terminada encerra o que abriu, inclusive o que saiu do grupo (o Postgres de teste),
   pela marca `NOD_GRUPO` (PR #254). O disco já se cuida (ADR-096).
7. **Falar com o usuário.** "Trabalhando" separado de "esperando a vez"; recomendação de máquina a partir do tempo de
   fila medido.

## No Mac e em várias máquinas

| | VM | Mac (Este Mac) | Várias máquinas |
|---|---|---|---|
| De quem é a máquina | só dos bots | da pessoa, que usa outros apps | cada uma conforme o seu tipo |
| Memória que os bots usam | toda, menos a do sistema | o que "O quanto os bots podem usar" libera | por máquina |
| Limite por task | grupo por task (cgroup) | não existe; fila com mais folga e prioridade baixa | por máquina |
| Fila do forno | uma | uma, mais conservadora | uma por máquina |
| "Ver como acelerar" | máquina maior, espalhar rotinas | deixar usar mais, conectar uma VM, espalhar rotinas | mandar a task nova para a máquina folgada |

A distribuição entre máquinas fica para o Marlon escolher (ADR-097). A recomendada: o bot em "qualquer máquina" começa
cada task nova na máquina com folga em que está pronto, e a task em andamento não muda de máquina.

## Responsabilidade do usuário

1. **Tamanho da máquina e orçamento.** Define quantos comandos pesados rodam por vez. O nod recomenda (item 7).
2. **Quanto da máquina dá para os bots.** A opção que já existe.
3. **O peso do próprio projeto.** O nod aponta ("os testes deste projeto são o que mais pesa"); o usuário pede a
   otimização se quiser. O nod não muda o código do usuário por conta própria.
4. **Prioridades.** Quais bots e rotinas põe na mesma máquina. O que ele pede na conversa sempre passa na frente.

## Ordem de entrega

| Fase | O quê | Por quê |
|---|---|---|
| 0 | **0a** encerrar o que a task abriu (6, PR #254) · **0b** motor que não cai inteiro: `OOMPolicy=continue` e swap comprimido no instalador (4) · **0c** medição por task (1) | Pequeno, sem risco: para a VM de travar como em 11/10 e dá os números para calibrar o resto |
| 1 | Entrar pela memória (2), fila do forno com `nod-vaga` (3), bots econômicos (5) | É o que libera a dezena de agentes |
| 2 | Grupo por task na VM (`Delegate=yes`, peso e teto duro) e prioridade no Mac (4) | Deixa a máquina estável com muita gente |
| 3 | Tela e recomendação de máquina (7) | Usa os dados das fases anteriores |

| | Hoje | Depois da fase 1 |
|---|---|---|
| Agentes ao mesmo tempo | ~3 a 4: o portão para no primeiro pico de teste | 10 a 12 |
| Comandos pesados | todos juntos, brigando pela máquina | 2 a 3 por vez, os outros em fila |
| Pico de processador | segura a porta | só deixa os comandos mais lentos |
| Falta de memória | trava a VM inteira | segura o próximo comando pesado; se estourar, cai só a task culpada |

Os números de "depois" são estimativas a partir de uma amostra de 11/10. A fase 0 serve para confirmá-los.

## As telas

Protótipo com o CSS real do nod. O canvas interativo (20 telas, com notas) é
https://claude.ai/artifact/XaXtFMENn3e4T3VZowjDkG; a cópia completa, com as fontes, está em
[prototipos/agentes-e-trabalho-pesado](prototipos/agentes-e-trabalho-pesado/README.md).

### Numa VM

**Trabalhos com 10 bots.** Os que esperam o forno têm o anel vazado e "esperando a vez dos testes".

![Trabalhos](prototipos/agentes-e-trabalho-pesado/telas/01-trabalhos.png)

**O consumo da máquina**, atrás do clique no nome dela.

![Consumo da máquina](prototipos/agentes-e-trabalho-pesado/telas/02-trabalhos-consumo-da-maquina.png)

**Máquina apertada.** Os comandos esperam a vez, e os bots novos ficam "na fila · começa quando liberar memória".

![Máquina apertada](prototipos/agentes-e-trabalho-pesado/telas/03-trabalhos-maquina-apertada.png)

**A task esperando a vez.** O tempo, o que ela usa e quem está na frente ficam no cartão do status.

![Task esperando a vez](prototipos/agentes-e-trabalho-pesado/telas/04-task-esperando-a-vez.png)

**Na conversa**, a linha centralizada antes e depois.

![Conversa: espera a vez](prototipos/agentes-e-trabalho-pesado/telas/05-conversa-espera-a-vez.png)

![Conversa: rodou os testes](prototipos/agentes-e-trabalho-pesado/telas/06-conversa-rodou-os-testes.png)

**Máquinas.** Uma frase por máquina, o detalhe atrás da setinha, o aviso do dia apertado e o "Ver como acelerar".

![Máquinas](prototipos/agentes-e-trabalho-pesado/telas/07-maquinas.png)

![Máquinas: detalhe](prototipos/agentes-e-trabalho-pesado/telas/08-maquinas-detalhe.png)

![Máquinas: apertada](prototipos/agentes-e-trabalho-pesado/telas/09-maquinas-apertada.png)

![Como acelerar](prototipos/agentes-e-trabalho-pesado/telas/10-maquinas-como-acelerar.png)

**Descartada:** medidores fixos de vagas no topo de Trabalhos.

![Descartada: medidor de vagas](prototipos/agentes-e-trabalho-pesado/telas/11-descartada-medidor-de-vagas.png)

### No Mac

**Trabalhos no Mac**, com 1 comando pesado por vez.

![Mac: Trabalhos](prototipos/agentes-e-trabalho-pesado/telas/12-mac-trabalhos.png)

**O card do Mac**, com a memória dividida entre seus apps e os bots.

![Mac: detalhe](prototipos/agentes-e-trabalho-pesado/telas/13-mac-maquinas-detalhe.png)

**Mac apertado pelos apps da pessoa**, e as saídas do Mac.

![Mac apertado](prototipos/agentes-e-trabalho-pesado/telas/14-mac-apertado-como-acelerar.png)

### Em várias máquinas

**Trabalhos em 2 máquinas**, com o resumo por máquina aberto.

![Várias: Trabalhos](prototipos/agentes-e-trabalho-pesado/telas/15-varias-trabalhos-por-maquina.png)

**Máquinas**: vm-1 apertada, vm-2 folgada.

![Várias: Máquinas](prototipos/agentes-e-trabalho-pesado/telas/16-varias-maquinas.png)

**V3a, o Nod escolhe (recomendada)**: "Qualquer máquina", a task que começou na vm-2 e a vm-2 sem login.

![V3a: qualquer máquina](prototipos/agentes-e-trabalho-pesado/telas/17-v3a-qualquer-maquina.png)

![V3a: começou na vm-2](prototipos/agentes-e-trabalho-pesado/telas/18-v3a-task-comecou-na-vm-2.png)

![V3a: vm-2 sem login](prototipos/agentes-e-trabalho-pesado/telas/19-v3a-vm-2-sem-login.png)

**V3b, o usuário move**: o card sugere mover.

![V3b: sugere mover](prototipos/agentes-e-trabalho-pesado/telas/20-v3b-sugere-mover.png)

## Medições de 11/10 (base)

- VM `nod-motor-teste`, e2-highcpu-8 (8 vCPU, 8 GB), sem swap, 3 agentes Claude (Ze 1, Eng 1, Tarsila).
- `claude -p`: 290 a 340 MB e 3% a 6% de um núcleo cada.
- `tsc --noEmit`: 976 MB e 1,6 núcleo. Postgres embutido de teste do gamefik: 96% de um núcleo. vitest: 7 processos.
- Memória: 5,4 GB usados, 2,5 GB disponíveis. A tela dizia "925 MB" (só o Claude).
- `mac_leitura`: quase o dia todo perto de 0%; rajadas às 04:07, 05:37 e 13:23–13:38 UTC. `fundo_segurado` por
  processador de 30 s a 2,5 min por vez.
- Dois Postgres de tasks antigas do Eng 1 (nod-205, nod-206) de pé, com o init como pai.
- 14:35 UTC: sem memória (~4 GB em node, 3,4 GB em ~17 Postgres de teste). O OOM matou um processo e o systemd, com
  `OOMPolicy=stop`, derrubou o motor inteiro; a VM travou ~20 min sem swap e 6 turnos foram interrompidos. Às 16:20
  UTC a VM virou e2-standard-8 (32 GB), ainda sem swap.

## Padrões de mercado

Pesquisa de 11/10, detalhada na ADR-097. Cada peça vem de um padrão conhecido:

- processador × memória: o Kubernetes;
- entrada pela memória: o escalonador do Kubernetes;
- fila: o Bazel;
- estimativa medida: o Autopilot do Google e o VPA;
- espera no comando: o jobserver do make;
- swap comprimido: o Fedora.

A única parte sem padrão pronto é a fila de comandos dentro do agente. As ferramentas locais de agentes em paralelo
não cuidam de recursos, e quem as usa relata um teto de 4 a 8 agentes por máquina.

## Valores padrão (calibrar com a fase 0, sem decidir antes)

- Reserva por agente: ~400 MB.
- Janela da régua sustentada: 3 min.
- Ordem da fila: o que a pessoa pediu na conversa primeiro, depois a ordem de chegada.

## Para depois

- Fila para o Codex, que não tem o hook do Claude Code (até lá, só o grupo da task o protege).
- Distribuição entre máquinas: o nod escolhe ou o usuário move. Para o nod escolher, o bot precisa estar pronto em
  cada máquina (login das IAs, GitHub, repositórios clonados).
- Detalhes das telas (fase 3).
