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
3. **Fila do forno.** O hook antes de cada comando do bot pede vaga. Pesado = o pico de memória medido daquele comando
   naquela task e repositório. Sem folga, espera; o resto segue. VM de 8 GB: 2 a 3 por vez.
4. **Repartir a máquina.** VM: grupo por task (cgroup v2) com peso de processador e limite de memória, agente com
   peso maior que os comandos, swap comprimido no instalador. Mac: prioridade baixa para comando de fundo.
5. **Bots econômicos.** Testes do que mexeu durante o trabalho; suíte completa uma vez antes do PR.
6. **Limpar o que abriu.** Task terminada encerra o grupo inteiro. O disco já se cuida (ADR-096).
7. **Falar com o usuário.** "Trabalhando" separado de "esperando a vez"; recomendação de máquina a partir do tempo de
   fila medido.

## Responsabilidade do usuário

1. **Tamanho da máquina e orçamento.** Define quantos comandos pesados rodam por vez. O nod recomenda (item 7).
2. **Quanto da máquina dá para os bots.** A opção que já existe.
3. **O peso do próprio projeto.** O nod aponta ("os testes deste projeto são o que mais pesa"); o usuário pede a
   otimização se quiser. O nod não muda o código do usuário por conta própria.
4. **Prioridades.** Quais bots e rotinas põe na mesma máquina. O que ele pede na conversa sempre passa na frente.

## Ordem de entrega

| Fase | O quê | Por quê |
|---|---|---|
| 0 | Medição por task (1), swap na VM (4), encerrar o que a task abriu (6) | Pequeno, sem risco, dá os números para calibrar o resto |
| 1 | Entrar pela memória (2), fila do forno (3), bots econômicos (5) | É o que libera a dezena de agentes |
| 2 | Grupo por task na VM e prioridade no Mac (4) | Deixa a máquina estável com muita gente |
| 3 | Tela e recomendação de máquina (7) | Usa os dados das fases anteriores |

| | Hoje | Depois da fase 1 |
|---|---|---|
| Agentes ao mesmo tempo | ~3 a 4: o portão para no primeiro pico de teste | 10 a 12 |
| Comandos pesados | todos juntos, brigando pela máquina | 2 a 3 por vez, os outros em fila |
| Pico de processador | segura a porta | só deixa os comandos mais lentos |
| Falta de memória | trava a VM inteira | segura o próximo comando pesado; se estourar, cai só a task culpada |

Os números de "depois" são estimativas a partir de uma amostra de 11/10. A fase 0 serve para confirmá-los.

## Medições de 11/10 (base)

- VM `nod-motor-teste`, e2-highcpu-8 (8 vCPU, 8 GB), sem swap, 3 agentes Claude (Ze 1, Eng 1, Tarsila).
- `claude -p`: 290 a 340 MB e 3% a 6% de um núcleo cada.
- `tsc --noEmit`: 976 MB e 1,6 núcleo. Postgres embutido de teste do gamefik: 96% de um núcleo. vitest: 7 processos.
- Memória: 5,4 GB usados, 2,5 GB disponíveis. A tela dizia "925 MB" (só o Claude).
- `mac_leitura`: quase o dia todo perto de 0%; rajadas às 04:07, 05:37 e 13:23–13:38 UTC. `fundo_segurado` por
  processador de 30 s a 2,5 min por vez.
- Dois Postgres de tasks antigas do Eng 1 (nod-205, nod-206) de pé, com o init como pai.

## Em aberto

- Reserva por agente (~400 MB) e o quanto guardar para comandos pesados.
- Janela da régua sustentada (3 a 5 min?).
- Ordem da fila: chegada ou prioridade.
- Fila para o Codex, que não tem o hook do Claude Code.
