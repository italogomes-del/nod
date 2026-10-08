# ADR-085 — Uso do Mac: o Mac apertado segura trabalho novo em segundo plano

Status: aceito · Data: 2026-10-08 · Emenda a [ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) §4 ("sem teto:
o limite é a máquina"). Decisão do Marlon em 2026-10-08: o caminho "sem teto, sem desperdício", aprovado no protótipo
"Nod — Ritmo do Mac" (canvas VmT4WwEbgfZ14PbLy4En8d, pranchas 1–3).

## Contexto

Em 06/10 o diário rodou 8 bots ao mesmo tempo e o Mac chegou a carga 265 em 12 núcleos (22 por núcleo). Medido no
diário, 7 dias até 08/10: nos minutos com algum turno, o p50 é 3 turnos ao mesmo tempo, o p90 é 7 e o máximo é 23.
Cada `claude -p` ocupa ~300 MB; quem derruba o Mac são os comandos que os bots disparam (baterias de teste, um `grep -r`
de 2 h sobre `~/nod`, que tem 109 GB), e isso é processador, que a ADR-083 não mede.

A ADR-083 rejeitou um teto de trabalhos ("a máquina varia de 8 a 36 GB; um teto de 8 travaria o pico de 25") e ficou com
a pressão de memória do macOS, que só avisa e fecha quem espera a pessoa. O Marlon pediu um controle em Configurações e
escolheu, entre teto fixo e "sem teto, sem desperdício", o segundo: nada de número de bots; a pessoa diz quanto do Mac
eles podem usar, e o Mac apertado segura o que ainda não começou.

## Decisão

1. **Processador.** O amostrador da ADR-083 (`src/adapters/executor/amostrador-memoria.ts`) também lê `vm.loadavg` a
   cada 30 s: a carga do último minuto por núcleo vira nível (`nivelDoProcessador`, `src/domain/memoria-mac.ts`) —
   amarela a partir de 0,7, vermelha a partir de 1,0. `LeituraMemoria.processador` é opcional: app anterior não manda.
   `NOD_SIMULAR_PROCESSADOR` (carga por núcleo) força a leitura em testes e UAT.
2. **A leitura vai no `puxar`.** Antes ela só ia na renovação, ou seja, só com turno rodando; um Mac parado não tinha
   leitura e o servidor não saberia que ele está apertado pelo que a pessoa faz nele. Agora o laço manda
   `daMaquina()` em todo `puxar` (`PonteInterna.puxar(pessoaId, maquina?)`), e o servidor a guarda por Mac em
   `trabalhosVivos` (`daMaquina`), como a da renovação.
3. **Uso do Mac** (`preferencias.uso_do_mac`, 0064; Seu espaço › Este Mac): `pouco` | `equilibrado` (padrão) | `livre`.
   `deveSegurar` decide pelo Mac que pede: `livre` nunca segura; `equilibrado` segura com a memória em alerta (amarela)
   ou o processador cheio (vermelha); `pouco` também com o processador começando a apertar (amarela). Sem leitura, nada
   é segurado.
4. **O que espera.** No `reivindicar`, com o Mac apertado, só **trabalho novo em segundo plano** fica `pendente`: turno
   de trabalho de origem `rotina` ou `colega` com `iniciado_em` nulo e sem ninguém esperando (`seguravelPeloMac`,
   `src/domain/memoria-mac.ts`). Conversa, ligação, task aberta pela pessoa e continuação de trabalho já começado seguem.
   Nada que roda é interrompido. Revisão do PR #209:
   - **Quem a pessoa espera não é segurado** (`trabalhos.pessoa_esperando`, 0064): "Executar agora" e "Permitir e rodar
     agora" numa rotina, e o pedido a colega feito num turno de conversa, sala ou ligação (fora de task).
   - **Espera máxima de 1 h** (`ESPERA_MAXIMA_FUNDO_MS`). Depois ele roda mesmo com o Mac apertado: rotina que nunca
     roda e pedido de colega que nunca volta (o colega que pediu fica esperando sem aviso, o sintoma da ADR-084) são
     piores que um Mac lento por alguns minutos.
   - **Um de cada vez** (`ESPACO_FUNDO_MS`, 30 s): logo depois de um trabalho novo em segundo plano começar num Mac, o
     próximo daquele Mac espera 30 s, mesmo com o Mac folgado e mesmo o que passou da espera máxima. A leitura é de até
     30 s atrás e a carga é a média do último minuto: sem o espaço, quando o Mac alivia, tudo o que esperava começa na
     mesma leitura verde e o pico de 06/10 volta. Vale para `pouco` e `equilibrado`; `livre` e Mac sem leitura não
     espaçam.
5. **Tela.** `TrabalhosDto` ganha `processador`, `cargaProcessador` e `segurando` (pelo pior Mac da pessoa: com dois
   Macs, um apertado já diz "ocupado", embora o puxar decida por Mac), e cada trabalho ganha `seguravel` (a regra do
   item 4, calculada no servidor). A mudança só do processador também vira o frame `memoria.mudou`. A linha do trabalho segurado diz "esperando o Mac aliviar"; "Todos os trabalhos" mostra a pílula "Seu Mac
   está ocupado" (a de memória, quando existe, fica sozinha); Seu espaço › Este Mac mostra o resumo, as barras de
   memória e processador, quem trabalha (com a memória) e quem espera, e o seletor do uso.
6. **Memória por trabalho.** A memória de um trabalho só aparece com turno vivo. Antes a última leitura ficava gravada
   e "Todos os trabalhos" somava 18 × 200–400 MB de tasks sem processo, enquanto o topo dizia 606 MB.

7. **Robustez da leitura** (revisão do #209). No `puxar` HTTP, a leitura entra uma vez por pedido (repetida a cada
   250 ms durante a espera de 20 s ela passava por cima da mais nova da renovação); leitura com defeito vira "sem
   leitura", nunca 400; processador fora do formato é ignorado, não a leitura toda. O "uso do Mac" é lido fora da
   transação do puxar e guardado por 30 s (`USO_VALE_MS`); um erro na leitura usa o último valor ou o padrão. O evento
   de pressão que não foi gravado (a transação desfez) volta o "visto", e a próxima leitura o refaz. A leitura do Mac
   que desconectou sai na hora, e a vencida sai na próxima leitura. Fora do macOS (sem `NOD_SIMULAR_*`) o amostrador
   não produz leitura da máquina.
8. **Medir.** Logs `fundo_segurado` / `fundo_solto` (na mudança, por Mac, com o uso e os níveis) e `fundo_comecou`
   (cada trabalho novo em segundo plano que começa, com `espera_ms`). No banco, `iniciado_em - criado_em` dos trabalhos
   `rotina`/`colega` dá a espera de cada um.

## Alternativas rejeitadas

- **Teto fixo de bots ("Ritmo": Leve 2, Equilibrado 4, Livre).** Prototipado e descartado pelo Marlon em 08/10: trava
  quando muita coisa chega junto, e o número certo depende do Mac. O motivo da ADR-083 continua.
- **Limite de memória em GB.** Técnico demais para a pessoa e chega tarde: não dá para tirar memória de quem já roda.
- **Segurar também a task da pessoa.** Ela pediu e está esperando; a regra da conversa vale para ela.
- **Segurar sem prazo.** Rejeitado na revisão do #209: o trabalho segurado não aparecia em lugar nenhum além da linha
  "esperando o Mac aliviar", e uma rotina das 9 h podia não rodar no dia.
- **Soltar tudo na primeira leitura verde.** Rejeitado na revisão do #209 (o "um de cada vez" do item 4).

## Limitação conhecida

A task que um bot abre com `abrir_task` numa conversa nasce com origem `pessoa` e não é segurada, mesmo quando o bot
coordenador abre várias de uma vez. Separar "a pessoa pediu" de "o bot decidiu abrir" pede marcar quem pediu em cada
`abrir_task`; fica para quando os logs `fundo_*` mostrarem picos vindos daí.

## Não implementado (segue em PRs próprios)

- "Esperando fora do Mac": mostrar a espera por colega (que já não ocupa processo) como "esperando X", e "me chame às
  16:00".
- Comando longo fora do Mac: o bot dispara a bateria de testes pelo Nod, sai do Mac e volta quando ela termina.

## Gatilho de reversão

- `fundo_comecou` com `espera_ms` na espera máxima (1 h) mais de uma vez por semana, com o Mac em `equilibrado`: rever
  os limiares de carga (0,7 e 1,0) ou o que conta como "segundo plano".
- Pressão vermelha de memória mais de um dia por semana em algum Mac, mesmo com o uso em `pouco`: reabrir o teto.
