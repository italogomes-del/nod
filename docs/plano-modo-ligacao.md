# Plano: modo ligação (todo bot atende por voz) e onboarding por ligação

> Plano aprovado para execução em 2026-10-04. Desenhado a partir de três pesquisas (voz aberta, GPU no GCP e provedores pagos), três desenhos independentes, uma síntese e duas críticas (completude e conferência no código).

## Contexto

O nod vai ganhar um **modo ligação**: qualquer bot pode ser chamado como numa ligação de telefone —
conversa contínua por voz, com legenda/transcrição, enquanto o bot continua agindo (criar bot, conectar
app, criar rotina, pedir a outro bot, pedir aprovação). É também o coração do novo onboarding aprovado
em 2026-10-03 (protótipos no canvas "Nod — onboarding mágico"): IA conectada → a primeira bot liga →
entrevista em tela cheia → a ligação continua numa pílula enquanto ela guia a configuração.

Restrições do produto:
- O **cérebro** de toda ligação é o executor que a pessoa já tem no Mac (Claude Code ou Codex, com a
  assinatura dela). O nod não paga uso de modelo de linguagem.
- A **voz** (entender a fala e falar) começa paga (Google, pelos créditos), porque sai muito mais barata
  que GPU própria até milhares de pessoas (ver "Custos"). O open source fica na orquestração da ligação
  e como caminho de saída: trocar de provedor, ou ir para modelos abertos numa GPU, vira configuração.
- A experiência precisa parecer uma ligação: latência baixa, dá para interromper o bot, voz natural em pt-BR.

## Decisões do Marlon (2026-10-03)

| Tema | Decisão |
|---|---|
| Onde ligar na v1 | **Mac primeiro**; ligação pelo celular numa fase seguinte |
| Onde roda a voz | **No servidor** (sem download no Mac), em CPU, chamando um provedor pago |
| Provedor de voz na v1 | **Google, pago pelos créditos GCP**: STT Gemini 3.5 Transcribe Live (reserva: Chirp 3) + voz Chirp 3 HD (30 vozes pt-BR), ≈US$0,020 por minuto de ligação. Camada plugável; teste cego nas 2 primeiras semanas (Google x ElevenLabs x Soniox) |
| Áudio fora do Brasil | **Pode**, com contrato (DPA) |
| Executores na v1 | **Claude Code e Codex** (Codex por um driver novo no `codex app-server`) |
| Voz no dev | **Grátis e leve**, só na máquina de quem desenvolve: `say` do macOS + whisper.cpp (ver "Modo dev grátis") |
| Aprovação durante a ligação | **Por voz, com confirmação**: o bot lê o item e pede uma frase de confirmação; qualquer item pode ser aprovado falando |
| O que fica no histórico | **Linha "Chat de voz · mm:ss" + transcrição apagável**; o que o bot fez vira registro normal |
| Todo bot | ganha modo ligação |
| Voz de cada bot | **Própria**, escolhida na criação como o mascote (trocável nos ajustes) |
| Ligação com vários bots | **Só 1:1 na v1**; o bot pode pedir ajuda a outros por trás |
| Tarefa longa durante a ligação | **Segue a conversa e avisa** quando terminar (ou deixa mensagem se a ligação acabou) |
| Camada de conversa | **Respostas curtas + falas de espera já gravadas**, robusta, pt-BR primeiro |

## Fatos já verificados

- ADR-067 (sessão viva): o Claude Code já roda com `--input-format stream-json` e stdin aberto; mensagem
  escrita no stdin com o modelo trabalhando entra na mesma volta. É a base para a latência baixa.
- GPUs no GCP `southamerica-east1`: N1+T4 (zonas a, b, c) e G4 (RTX PRO 6000, zonas a, b). Sem L4.
- Tamanhos (HF/GitHub, 2026-10-03): Piper pt-BR ~63 MB por voz (cadu, faber, jeff: dataset CC0;
  edresson: CC BY 4.0; motor original MIT arquivado, sucessor GPL-3.0); Whisper ggml tiny-q5 32 MB,
  base-q5 60 MB, small-q5 190 MB, large-v3-turbo-q5 574 MB (multilíngue, ~99 idiomas num arquivo);
  Kokoro ONNX 86–326 MB (8 idiomas incl. pt-BR); Silero VAD 2,3 MB; Vosk pt pequeno 32 MB.

## Custos: hospedar x pagar (preços de lista lidos em 2026-10-03)

**T4 x G4 são gerações diferentes de GPU.**
- **T4** (2018, 16 GB, sem bf16): transcreve bem umas 5–10 ligações por máquina, mas só roda vozes
  pequenas, que soam robóticas. Custa ~US$414/mês em SP e foi descontinuada: desliga em 01/08/2027.
- **G4** (RTX PRO 6000 Blackwell, 2025, 96 GB, memória ~5× mais rápida): roda as vozes abertas naturais
  (Qwen3-TTS, VoxCPM2) para dezenas de ligações (não medido). Em SP só existe a GPU inteira, por
  ≈US$4.500–5.200/mês. É uma estimativa a partir do preço de Iowa (US$4,50/h), porque o preço de SP não é
  publicado. Frações de 1/8 de G4 (~US$472/mês) só existem em us-central1-b.

**Quadro.** Minuto de ligação = 1 min de STT (stream aberto) + 0,4 min de fala do bot. "?" quer dizer
sem avaliação independente em pt-BR.

| Opção | US$/min de ligação | Qualidade pt-BR | Voz própria por bot | Áudio no Brasil | Créditos GCP |
|---|---|---|---|---|---|
| T4 em SP (hospedar) | fixo: US$414/máquina | STT boa, voz robótica | Fraca | Sim | Sim |
| G4 em SP (hospedar) | fixo: ≈US$5.000/máquina | Boa a alta (sem teste cego) | Clonagem (não testada) | Sim | Sim |
| 1/8 de G4 nos EUA (hospedar) | fixo: ≈US$472/máquina | Boa (sem teste cego) | Clonagem | Não | Sim |
| Soniox | 0,0067 | STT alta?; voz nova (ago/2026) | 200+ vozes, 20 clones | Não | Não |
| xAI | 0,0087 | ? | Vozes prontas | Não | Não |
| AWS (Transcribe SP + Polly) | 0,0158 | Voz datada | 3 vozes | Parcial | Não |
| Google C (Transcribe Live + Gemini 3.8 TTS) | 0,0161 (0,013 até dez/2026) | Boa? (preview, sem SLA) | Sim, voz criada por descrição | Não | Sim |
| Soniox + ElevenLabs | 0,0164 | Alta? | A melhor | Não | Não |
| **Google B (Transcribe Live + Chirp 3 HD)** | **0,0197** | Boa? | 30 vozes pt-BR | Não | **Sim** |
| ElevenLabs (Scribe v2 + Flash/v4 Turbo) | 0,0209 | Alta? | A melhor: 746 vozes pt-BR | Não | Não |
| Azure Brazil South | 0,0221 | Boa, voz "clássica" | 18 vozes | **Sim** | Não |
| Google STT + ElevenLabs | 0,0233 (0,0144 em dinheiro) | Alta? | A melhor | Não | Parcial |
| Google A (Chirp 3 + Chirp 3 HD) | 0,0268 | Boa? (SLA 99,9%) | 30 vozes | Não | Sim |
| OpenAI cascata | 0,027 | Vozes feitas para inglês | Nenhuma pt-BR | Não | Não |
| OpenAI GPT-Live (pronto) | 0,050 (tempo de relógio) | Boa, mas parafraseia | 2 vozes pt-BR | Não | Não |
| ElevenLabs Agents (pronto) | 0,080 | Alta? | A melhor | Não | Não |

**Simulação em escala.** Perfil intenso: 15 min de ligação por dia útil × 22 dias = 330 min por pessoa
por mês. Pico = 2× a média de um dia de 8 h. G4 com 30 ligações por máquina (não medido) + 1 máquina de
reserva. Valores em US$/mês.

| Pessoas | Pico simultâneo | Soniox | Google B | ElevenLabs | Azure BR | GPT-Live | G4 ligada 24 h | G4 com autoescala |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 2,22 | 6,50 | 6,90 | 7,29 | 16,50 | 10 mil | 10 mil |
| 10 | 1 | 22 | 65 | 69 | 73 | 165 | 10 mil | 10 mil |
| 100 | 6 | 222 | 650 | 690 | 729 | 1,6 mil | 10 mil | 10 mil |
| 1.000 | 63 | 2,2 mil | 6,5 mil | 6,9 mil | 7,3 mil | 16,5 mil | 20 mil | 11 mil |
| 10.000 | 625 | 22 mil | 65 mil | 69 mil | 73 mil | 165 mil | 110 mil | 33 mil |
| 100.000 | 6.250 | 222 mil | 650 mil | 690 mil | 729 mil | 1,65 mi | 1,05 mi | 243 mil |
| 1.000.000 | 62.500 | 2,2 mi | 6,5 mi | 6,9 mi | 7,3 mi | 16,5 mi | 10,4 mi | 2,4 mi |

- **Perfil leve** (5 min por dia útil): os pagos custam 1/3 disso. A G4 fica no piso de US$10 mil até
  ~3 mil pessoas. Com autoescala, custa US$15 mil com 10 mil pessoas, US$85 mil com 100 mil e
  US$795 mil com 1 milhão.
- **Por que a G4 ligada 24 h nunca passa o Google:** a ligação se concentra no horário comercial, então a
  máquina fica ~88% do tempo ociosa. Isso corrige a estimativa anterior ("empata perto de 250 mil
  min/mês"), que ignorava pico e reserva.
- **Com autoescala** (melhor caso, porque exige conseguir GPU toda manhã), a G4 passa o Google a partir
  de ~2 mil pessoas no perfil intenso (~6 mil no leve). Contra a Soniox, só empata, mesmo com 1 milhão de
  pessoas. Se cada G4 aguentar 60 ligações, passa a Soniox a partir de ~7 mil pessoas (intenso).
- **Fora da conta:**
  - 1–2 pessoas dedicadas para operar as GPUs;
  - descontos enterprise dos provedores acima de ~US$10 mil/mês (não publicados);
  - compromisso de 3 anos na G4 (−56% no preço de Iowa).
- **Créditos** (~US$24,9 mil; escopo e validade não verificados), gastando com o Google B:
  - 100 pessoas: ~38 meses;
  - 1.000 pessoas: ~4 meses no perfil intenso ou ~11 no leve;
  - 10 mil pessoas: ~11 dias no perfil intenso.
- **Onboarding** (8 min por pessoa nova): US$0,05 (Soniox) a US$0,16 (Google B). As falas de espera são
  geradas uma vez por voz, por ~US$1–3 no total, e tocadas do cache.
- **Concorrência:** acima de ~100 ligações simultâneas (~1.600 pessoas no perfil intenso), todos os
  provedores exigem aumento de cota ou plano enterprise. A Soniox, por padrão, aceita só 10 STT e 3 vozes
  simultâneas.
- **Latência:** é parecida em todas as opções. Um provedor nos EUA soma ~0,1–0,15 s em cada sentido
  (estimativa). O que domina é o Claude Code pensar (0,8–2 s), e isso as falas de espera cobrem.

## Arquitetura

Os caminhos são relativos à raiz do repositório. Limiares marcados "definido em 2026-10-04" são ponto de partida. A fase 0 e o corpus pt-BR os calibram.

### Visão geral

```
Renderer do app (Mac)                       nod (processo único, e2-medium)              Google (EUA)
microfone → AEC → PCM 16 kHz ══WSS mídia══▶ orquestrador de voz ───── áudio ─────────▶ Transcribe Live
alto-falante ◀ PCM 24 kHz ◀══ voz + legenda ══ │ VAD, fim de turno, esperas, eco ◀ texto ┘
                                                │ trechos pt-BR ───────── texto ───────▶ Chirp 3 HD
Processo principal do Electron (Mac)          │                       ◀── áudio ──────┘
laço de voz: claude -p | codex app-server ◀══WSS cérebro══ vez, nota [nod], interromper
                                          ══ fala, atividade ══▶   (o Mac abre o canal; o servidor nunca disca)
Ferramentas: CLI → proxy MCP → /api/interno · Decisões: renderer → REST com o cookie (comandoId)
```

- **A voz roda dentro do processo do nod, em TypeScript** (`src/adapters/voz/`): STT, TTS, VAD, fim de turno, esperas, interrupção, janela de aprovação. Não há container, porta nem JWT novos. O plano e o token do turno já ficam na memória do nod (ADR-024). Dependência nova só no servidor: `ws`, registrada na ADR-071 e em `THIRD_PARTY_NOTICES.md`. O cliente do Mac usa o `WebSocket` global (undici). Saída futura pelo protocolo e pela SPI: serviço próprio ou GPU.
- **O cérebro roda no Mac**, num turno `origem='ligacao'` com sessão própria, modelo rápido, prompt curto e ferramentas leves. O trabalho pesado vira turno normal do bot ligado à ligação.
- **Dois canais WSS por ligação**, pelo Caddy atual até `nod:8888`: o de mídia (renderer, com cookie) e o do cérebro (Mac, com token do turno).
- **Áudio** em PCM16: 16 kHz subindo, 24 kHz descendo. O servidor manda até 300 ms adiantado e o cliente segura 60–100 ms de buffer. O áudio nunca é gravado e nunca passa pelo barramento nem pelo SSE. O mesmo canal funciona no navegador, que é o caminho do celular.

### Peças

| Peça | Onde roda | O que faz |
|---|---|---|
| Motor (`web/lib/ligacao.ts` + worklets de captura e de toque) | Renderer | Microfone com `echoCancellation:'all'` (reserva: `true`), quadros de 20 ms. Toca a voz no mesmo Chromium, para o AEC usá-la como referência. Abaixa o volume na hora e manda `tocado`. |
| Tela (`web/telas/ligacao.ts`) | Região nova `#ligacao`, irmã de `#espaco` (`web/index.html:23-24`) | Tela cheia (deixa a `.app` inerte, como `web/main.ts:740-743`) e pílula PiP (não inerte), com legenda, card e transcrição |
| Orquestrador (`src/adapters/voz/orquestrador.ts`) | nod | Uma `LigacaoViva` por ligação. As regras são funções puras em `src/domain/ligacao-*.ts`. Grava por callbacks e não importa banco. |
| Provedores (`src/adapters/voz/spi.ts`) | nod → Google | STT: Live API por WebSocket, com token do metadata da VM (ADC em dev). TTS: Chirp 3 HD por REST. Provedor `local` (grátis) no dev e `falso` nos testes. Troca por env. |
| Laço de voz (`src/adapters/executor/cerebro-ligacao.ts`) | Main do Electron | `claude -p` com stdin aberto; `codex app-server` na fase 4 |
| Turno de trabalho | Executor de sempre | `iniciar_tarefa` enfileira um turno do bot com `ligacao_id` |
| Ferramentas | Proxy MCP, com mudança no modo ligação | Sem espera dentro da ferramenta (`fatiasAprovacao`=0, `proxy.ts:169`) e `INSTRUCAO_PENDENTE` própria (`proxy.ts:53`) |
| Registro | Postgres com RLS | `ligacoes`, `ligacao_falas`, `turnos.ligacao_id`, linha "Chat de voz", resumo |

**SPI:** `TranscritorStreaming` emite parciais e finais com confiança, mais capacidades (carimbos, vocabulário, fim de fala manual). `Sintetizador` devolve um iterável de PCM, mais capacidades (streaming, pronúncias, velocidade). O orquestrador se adapta às capacidades. A reserva Chirp 3 e o TTS em streaming são gRPC: a fase 0 prototipa `@grpc/grpc-js` e decide.

### Modo dev grátis (só na máquina de quem desenvolve)

Pedido do Marlon em 2026-10-04: em dev, a voz tem que funcionar sem custo, mesmo robótica, desde que dê para entender.

- `NOD_VOZ_STT=local` e `NOD_VOZ_TTS=local` são o padrão fora de produção no macOS. O provedor `falso` (sem áudio de verdade) fica para os testes automáticos e o CI.
- **Falar:** o `say` do macOS. Conferido em 2026-10-04 num M1 com macOS 26.0: 9 vozes pt-BR já instaladas (Luciana, Eddy, Flo, Reed, Rocko, Sandy, Shelley, Grandma, Grandpa), então cada voz do catálogo `VOZES_NOD` tem uma equivalente local e cada bot pode ter uma voz diferente. Medido em 2026-10-04: ~0,7 s para gerar uma frase de ~50 caracteres em WAV 24 kHz, contando o processo. Gera por frase.
- **Entender:** whisper.cpp (`brew install whisper-cpp`, MIT) com `ggml-base-q5_1.bin` (~60 MB) em `~/.cache/nod/voz` (fora do `NOD_HOME`, EMENDA 11). O nod sobe o `whisper-server` em 127.0.0.1 sob demanda no dev. Medido em 2026-10-04: 0,41 s para transcrever ~5 s de fala com o modelo quente (o primeiro carregamento leva ~30 s, compilando o Metal). Sem parciais: a vez termina pelo silêncio e o trecho inteiro vai para a transcrição; a legenda aparece quando a pessoa termina de falar. A interrupção usa só a regra dos 600 ms de fala. Se errar demais, `small` (~190 MB).
- **Falas de espera** geradas com o `say` sob demanda e guardadas no mesmo cache.
- `scripts/voz/preparar-local.sh` confere `say`, vozes e whisper-cpp e baixa o modelo.
- **Cérebro no dev:** o catcher (custo zero, respostas roteirizadas) ou o Claude Code/Codex de verdade pelo interruptor da Frota. Dá para ligar pelo Chrome em `localhost:5274` (o proxy do Vite passa o WSS) ou pelo app desktop apontado para o servidor local.
- Custo zero; a voz funciona sem internet.

### Protocolo nod-voz/1 (`src/contracts/voz.ts`)

- **Binário:** byte 0 é o tipo (`0x01` microfone, `0x02` voz). Bytes 1–4 são a sequência u32. Bytes 5–6 são o `utt` u16 (só no `0x02`). O resto é PCM16LE. Controle vai em JSON `{t,…}`.
- **Mídia** (`/api/t/:tenant/voz/v1/midia`):
  - Cliente: `ola {v, ligacaoId, entrada, saida, retomar?}` em até 5 s; `tocado {utt,ms}` a cada 250 ms; `tocou-fim {utt}`; `interrompido {utt,ms}`; `texto`; `mudo`; `ping`; `tchau`.
  - Servidor: `pronto`; `estado {fase, rotulo?}`; `legenda {id,texto,final}`; `bot-fala {utt,tipo,texto}`; `subir`; `interromper`; `janela {decisaoId, ate}`; `comando {comandoId, decisaoId, acao}`; `cerebro {online}`; `fim {motivo}`.
- **Cérebro** (`/api/interno/voz/v1/cerebro`):
  - Servidor → Mac: `vez {n, texto, ouvidoAte?}`, `nota {texto, confiavel}`, `interromper {modo: suave|duro}`, `fim`.
  - Mac → servidor: `ola {ligacaoId, capacidades}`, `fala {seq, delta}`, `fala-fim`, `atividade {tipo,nome}`.
- **Regras:** sequência crescente; ping a cada 15 s; reconexão em até 10 s (mídia) e 20 s (cérebro). Áudio subindo acima de 1,2× o tempo real fecha a conexão. Fechamentos: 4400 versão, 4401 sessão, 4403 origem, 4409 já em ligação, 4410 encerrada, 4503 voz fora/drenagem.
- **Autenticação da mídia:** `resolverEscopo` sobre o `IncomingMessage` do upgrade, com tenant igual ao da sessão, `Origin` do mesmo host (hoje as rotas de tenant não conferem: `roteador.ts:135-153`), ligação da própria pessoa, uma conexão por ligação. As regras de interno e de tenant (`roteador.ts:108-153`) viram funções usadas pelo roteador e pelo upgrade.
- **Autenticação do cérebro:** sem `Origin`, `autorizarTokenTurno`, e `planoDe(turnoId).ligacaoVoz.ligacaoId` tem de ser a mesma ligação. `revogar` só apaga do Map (`token-turno.ts:83-85`): criar o gancho `aoRevogar`, que fecha o canal, e reautorizar a cada 20 s (ADR-031).

### Cérebro: Claude Code e Codex

**Turno da ligação** (`origem='ligacao'`, `turnos.ligacao_id`, `plano.ligacaoVoz {ligacaoId, modelo}`)
- Reaproveita plano, token, lease, proxy, Raio-X e gastos.
- Fica fora dos dois `NOT EXISTS` de `reivindicar` (`turnos.repo.ts:170`; parâmetro novo em `despachar-turno.ts:36`). Passa na frente da fila. Só vai para máquina que anunciou `ligacao` em `conectar`, de preferência o Mac que abriu a ligação.
- `conectar` hoje recusa reanúncio com plano ativo há menos de 90 s (`ponte.ts:84-85`): aceitar reanúncio que só muda capacidades.
- O harness é o do bot, resolvido ao ligar; um bot com Codex nunca cai para o Claude. O modelo de voz fica no plano, não em `turnos.modelo`.
- **Sessão própria e efêmera.** O fixture `s2c` só prova exit 1 com `--session-id` repetido (`tests/fixtures/stream-json/LEIA-ME.md:9`). Concorrência com `--resume` não foi medida. O motivo da sessão própria é ter prompt e modelo diferentes sem escrever no mesmo `.jsonl`. `sessaoDaConversa` exclui `ligacao` no plano (`emitir-plano-turno.ts:126`) e no assentar (`assentar-turno.ts:146-148`).

**Claude Code** (`montarArgsLigacao`, ao lado de `montarArgs` em `claude-cli.ts:145`). O argv completo tem teste unitário:
- `-p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`
- `--model <plano.ligacaoVoz.modelo>` (resolvido no servidor; padrão `claude-sonnet-4-6` desde a NOD-164) e `--effort <nível>` se a config pedir e o `--help` listar
- `--system-prompt <voz>`, com `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` antes de memória e contexto (exige CLI ≥2.1.275; piso geral hoje 2.1.272)
- `--tools "" --strict-mcp-config --mcp-config <proxy> --allowedTools "mcp__nod__*"`
- `--setting-sources project --no-session-persistence`
- Pisos em `flag-floors.ts`. Sem a flag de persistência, o driver apaga o `.jsonl` da sessão ao encerrar.
- **Ambiente** injetado em `montarEnvDoFilho` (`claude-cli.ts:207-223`), depois da denylist que remove `CLAUDE_CODE_*` (`ambiente-executor.ts:10-19`): `MAX_THINKING_TOKENS=0`, `ENABLE_TOOL_SEARCH=false`. `--thinking` é oculta no help: se entrar, registrar com `ocultaNoHelp:true` e piso.
- **cwd estável** por bot (`NOD_HOME/ligacoes/<agenteId>`), para aproveitar o cache. É exceção ao "mkdtemp por turno" da EMENDA 11: a ADR-071 emenda a ADR-014.
- **Latência de referência** (`s7-sessao-viva.jsonl`): 4.052 ms a frio, gravando ~167 mil tokens no cache; 758 ms quente. São teto pessimista para um prompt curto. O CLI sobe durante o toque, e a saudação cria o cache.

**Ida e volta:** `vez` vira linha no stdin via `mensagemClaude` (`anexos-turno.ts`). `text_delta` vai para `fala`, nunca para `sinks.delta`. `tool_use` vira `atividade`. No modo ligação, `aposRodada` (`claude-cli.ts:387`) só manda `fala-fim`, e `falarRodadas` (`:374`) não grava falas intermediárias. A latência vem dos campos `ttft_ms`, `ttft_stream_ms` e `time_to_request_ms` do `result`, lidos em `src/domain/stream-json.ts`.

**Interrupção** (`interromperGeracao?()` no SPI, `src/adapters/executor/spi.ts:47`)
- Modo duro: `{"type":"control_request","request_id":"…","request":{"subtype":"interrupt"}}`, casado com o `control_response` pelo `request_id`. Exige `interrupt_receipt_v1` no `system/init`. `cancel_queued:true` só vai se o init anunciar `interrupt_cancel_queued_v1`. `stream-json.ts:53` passa a ler `capabilities` e `control_response`.
- Modo suave: nada morre. A `vez` seguinte leva "[nod] Você foi interrompido; a pessoa ouviu até "…"". Nunca passa pelo Parar.

**Fim:** o driver pede "resumo para o chat em até 5 linhas, não será falado" e fecha o stdin. O resumo vira mensagem do bot.

**Prompt de voz** (`src/domain/prompt-ligacao.ts`, com blocos de `prompt-sistema.ts`)
- `INSTRUCAO_MODO` (`prompt-sistema.ts:54`) ganha `ligacao`; sem isso o TS não compila. `PREFIXOS_DAS_SECOES` (`:304`) ganha "Fala:" e "Ligação:". A linha "Formatação:" (`:182`) fica fora do prompt de voz.
- **Fala:** até ~20 palavras, no máximo ~60 por resposta (o resto vai ao chat), sem markdown, números por extenso, sem abrir com "certo/beleza", sem responder a "uhum". O gênero da voz vai no prompt ("pronta/pronto").
- **Ligação:** anunciar a ação em até 6 palavras; trabalho demorado vai por `iniciar_tarefa`; `[nod] …` é aviso do sistema; o bot nunca aprova.
- Contexto: identidade, apps, colegas, até 15 memórias, últimas 10 mensagens.

**Catálogo** (`FERRAMENTAS_NOD_POR_MODO.ligacao`, `plano-turno.ts:75`)
- O da conversa sem `pedir_a_pessoa` e sem artefatos. Ganha os conectores concedidos (`plano-turno.ts:166-180`), com teto de 40 ferramentas e resultado cortado em 2.000 caracteres.
- Sem terminal: tirar o modo de `nativasDoTurno` (`nativas.ts:55-58`), de `motivoSemTerminal` (`:71-80`) e do `terminal` do plano (`emitir-plano-turno.ts:217`).
- `conversaComAPessoa` dá false com `ligacao_id` no plano (`modo-aprovacao.ts:35-37`), inclusive nos turnos de trabalho da ligação.

**Continuações:** no turno de ligação, a absorção pela renovação fica desligada (`aceitaMensagemNaSessao` exclui `ligacao`, `sessao-viva.ts:38-40`). Com a ligação viva, `enfileirarRetomada` não cria turno para o turno da ligação. Entrega o desfecho ao orquestrador, que manda `nota` numa brecha. `assentarAprovacao` sempre gera esse desfecho (`decidir.ts:251`). Com a ligação encerrada, vira turno de conversa com o modelo do bot (exceção na ADR-072).

**Trabalho pesado:** `iniciar_tarefa` enfileira um turno do bot (harness, modelo, kit e sessão dele) com `ligacao_id`, a confiança herdada e as 3 últimas falas literais da pessoa (ADR-047). Grava "Pedido na ligação: …" no chat e devolve na hora. Limite de 3 por ligação. Só turnos com o `ligacao_id` desta ligação geram nota falada, até 1.500 caracteres, via `barramento.inscrever` (`src/services/barramento.ts:38`). O conteúdo passa por `neutralizarDelimitadores`, ganha a moldura de não confiável e tem `[nod]` escapado. Rotinas só aparecem na pílula.

**Codex** (fase 4, `drivers/codex-app-server.ts` + parser puro `src/domain/codex-app-server.ts`)
- Fluxo: `initialize`/`initialized`, depois `thread/start` com `ephemeral:true`, instruções de voz e MCP. O launcher 0600 sai de `rodarTurno` (`codex-cli.ts:93-94`) para uma função comum; a config vai por `-c` no `codex app-server`.
- Cada `vez` vira `turn/start`, ou `turn/steer` com `expectedTurnId`. `item/agentMessage/delta` vira `fala`; `turn/interrupt` é o modo duro.
- Nega sempre `item/commandExecution/requestApproval`, `item/permissions/requestApproval` e `mcpServer/elicitation/request`; sem resposta, o turno trava.
- Conferência de flags própria, reaproveitando `-c features.*` (`:36-45`) e o filtro de ambiente (`:62`). Usa o menor esforço do Luna listado em `model/list`; atualizar `src/contracts/harness.ts:21` (sol e luna).

**Modelo por config do servidor** (NOD-164, emenda à ADR-072): `NOD_MODELO_LIGACAO_CLAUDE` (padrão Sonnet 4.6 com `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` injetado; o Haiku 4.5 saiu do padrão; C: Sonnet 5.5 `esforco=low`, só pela config). `NOD_MODELO_LIGACAO_CODEX` (Luna, menor esforço).

### Camada de conversa pt-BR (`src/domain/ligacao-*.ts`, puras, `agora` por parâmetro)

- **VAD do servidor:** o início e o fim de cada fala vêm da energia do áudio (seq × 20 ms), casados com o final do STT. O fim de fala é manual na Live API (`activityEnd`), disparado por esse VAD. O Transcribe Live não dá carimbo por palavra.
- **Fim de turno** (`ligacao-turno.ts`), base 600 ms de silêncio + final do STT; sem final em 300 ms, usa o último parcial.
  - +800 ms se termina em conjunção, preposição, artigo ou hesitação ("e", "mas", "que", "pra", "é…", "tipo", "aí");
  - −300 ms com fecho ou pergunta ("né?", "é isso") ou resposta curta a pergunta do bot;
  - +1 s em ditado; teto de 3 s.
  - Se a pessoa volta em até 800 ms, antes de ferramenta e de áudio, a vez é refeita. Sem geração especulativa.
- **Falas de espera** (`ligacao-espera.ts`). Clipes por (provedor, voz, velocidade, versão do texto). Gerados sob demanda dentro de `src/adapters/voz` com a credencial da VM, num cache que pode ser refeito (`/data/nod/vozes`). Clipe ausente não toca nada; nunca há TTS ao vivo no caminho crítico. Textos neutros em gênero.

| Categoria | Quando | Exemplo |
|---|---|---|
| Reconhecimento | 300 ms sem trecho (200 ms se o p50 do cérebro passar de 1,5 s); só em pedido; ≤40% das vezes; desligado no onboarding | "Tá." "Entendi." |
| Pensando | 1,6 s sem trecho; outra variante aos 4 s | "Hum, deixa eu ver…" |
| Ferramenta | 1,2 s após início, sem narração; genérica para conector | "Tô montando a rotina…" |
| Tarefa longa | 8 s; repete aos 20 s, 45 s e a cada 60 s (máx. 4) | "Isso leva um tempinho. Pode ir falando." |
| Não entendi | Final vazio ou de baixa confiança | "Desculpa, não peguei." |
| Ociosidade | 7 s e 20 s após pergunta; 3 min → despedida (suspensa com card, tarefa ou login aberto) | "Pode falar, tô ouvindo." |
| Queda e limite | Mídia ou cérebro fora; 1 min antes do máximo | "Perdi a conexão com o seu Mac; já volto." |

  Regras: o mesmo clipe não repete entre os últimos ⌈n/2⌉ nem em 60 s; pelo menos 2 s entre esperas. Se o conteúdo chega com até 350 ms restantes, a espera termina; senão, fade de 80 ms. Um "certo/beleza" logo após um reconhecimento é cortado do começo da resposta. Espera nunca entra no contexto do cérebro nem na transcrição, e nunca toca na janela de aprovação.
- **Texto falável** (`ligacao-frases.ts`): tira markdown e troca código, tabela e URL por "te mandei no chat" (postado no `fala-fim`). Primeiro trecho: primeira vírgula após 4 palavras, fim de frase, ou 400 ms com 3 palavras; depois, frases de até ~25 palavras. Nunca corta em Sr., nº, 1.000,50, 14h30, v1.2.3, index.ts ou URL. Léxico do Chirp e vocabulário do STT com nomes de bots, apps e repositórios.
- **Interrupção:**
  1. O worklet vê 3 quadros com energia (limiar maior com o bot falando) e baixa o volume para 30% em ≤50 ms.
  2. O servidor confirma, se não for eco, com: 2 palavras fora do backchannel; ou 1 palavra de parada ("para", "pera", "espera", "não", "cancela", "chega", "repete", "como assim"); ou 600 ms de fala.
  3. Confirmada: `interromper`, fade de 15 ms, TTS cancelado. Sem confirmação em 1,2 s: `subir`.
  4. "Ouviu até" (`ligacao-ouvido.ts`): frases inteiras tocadas mais a parcial cortada numa palavra.
  5. Modo duro no cérebro: sem ferramenta rodando, ou com "para/cancela/espera/chega". Nos outros casos, suave.
  6. Enquanto o bot lê conteúdo não confiável, só palavras de parada valem.
- **Backchannel** ("uhum", "tá", "sei", "isso", "ok", "beleza", "pois é"…): não interrompe. Com o bot calado e sem pergunta, vai só para a transcrição.
- **Eco** (`ligacao-eco.ts`): um trecho sobreposto à fala do bot (+300 ms) que repete ≥60% das palavras dos últimos 10 s do bot é descartado. Mais de 3 por minuto: sugerir fone. `devicechange` (AirPods/HFP) reabre a captura e avisa.
- **Narração:** "trabalhando · {rotuloFerramenta}" (`rotulo-ferramenta.ts:59`). Fala proativa só numa brecha: pessoa calada ≥700 ms, bot calado, fora da janela.

### Aprovação por voz

1. **Chegada:** toda decisão da conversa da ligação chega por `decisao.nova`. Uma por vez, em fila. Ao ligar, o bot avisa das pendências.
2. **Leitura** (`redigirLeituraDeAprovacao`, pura, montada pelo servidor):
   - ação, app, destino, quantidade e o `texto` de cada item (≤140 caracteres, sem URL nem código), no máximo 3 itens e depois "e mais N: veja na tela";
   - rotina: resumo + horário; perfil e bot: nome e título;
   - turno contaminado ou `origem_conector`: só campos tipados + "o texto está na tela";
   - itens `terminal`/`computador`: `rotuloFerramenta` + `comandoArriscado`, com o card visível na pílula;
   - fecha com "Para aprovar, diga 'eu aprovo'; para recusar, 'recuso'".
3. **Janela:** abre 300 ms após o `tocou-fim` da leitura e dura 20 s. Leitura interrompida não abre janela. Só vale fala final que começou depois da abertura (VAD), com ≥400 ms e sem sobreposição. "Repete" relê e reabre. Um clique na tela fecha a janela.
4. **Gramática por perfil** (`src/domain/comando-de-voz.ts`; compara a fala inteira sem acentos e cortesia):
   - aprovação e acesso: "eu aprovo", "aprovo", "pode aprovar";
   - bot, rotina, perfil: também "pode criar", "pode ser", "isso", "cria";
   - escolha: "a primeira/segunda/terceira" ou o horário dito;
   - recusa: "recuso", "não aprovo", "cancela"; qualquer negação recusa;
   - "sim/ok/pode" no perfil estrito: pede de novo uma vez;
   - "conecta" num app desconectado só abre o login no navegador.
5. **Comando do cliente:** o servidor manda `comando {comandoId, …}` (opaco, de uso único, válido por 10 s). O cliente chama `POST /decisoes/:id/decidir` (`rotas/decisoes.ts:88`) com `{canal:"voz", ligacaoId, comandoId, acao}` e o próprio cookie.
   - A rota confere o comando no orquestrador e monta o corpo sozinha. Em `aprovacao`/`gate_rotina`, recusar = todos os itens desmarcados (como a web faz, `web/main.ts:1566`); aprovar = seleção padrão. Em acesso e propostas, `{recusar:true}`.
   - Recusa `sempre`, `restoDaTarefa`, `itens` e `capacidades`.
   - `canal` passa por todas as chamadas de `decisoes.decidir` (`decidir.ts:69`, `decidir-acesso.ts:104`, `rotas/decisoes.ts:145`, `responder-decisao.ts:33`) e é gravado em `desfecho.canal` (`decisao.ts:27`, `decisoes.repo.ts:161`).
6. **Por voz:** `aprovacao`, `gate_rotina`, `retomar_turno`, `acesso` (app já conectado), `perfil`, `rotina*`, `bot`. **Fica de fora:** "Sempre permitir", edição, seleção parcial, login de app, decisora diferente da dona, decisão de outra conversa.
7. **Perguntas** (`pergunta`, `falta_de_dado`, `permissao`): janela própria, releitura do que foi transcrito, `POST /decisoes/:id/responder`.
8. **Resultado:** só é falado depois de `decisao_decidida`, e o cérebro recebe "[nod] já foi dito". Sem POST em 5 s: "não consegui registrar; aprova na tela". Usa `redigirDesfechoAprovacao` (`aprovacao-desfecho.ts:15`) sem o `textoFinal`. Ler um card conta como `vista_em` (emenda à ADR-007).

### Dados e histórico

Todas as migrações são só de adição (expand-only), porque o código velho roda sobre o schema novo durante a drenagem (`deploy.sh:49-50`).
- `0047_ligacao_enum.sql`: `ALTER TYPE origem_turno ADD VALUE 'ligacao'`. Fica sozinha porque o valor não pode ser usado na mesma transação (`migrar.ts:36`). Também `OrigemTurno` (`src/contracts/turno.ts:27`) e `ENUMS_DE_ESTADO.origem_turno` (`schema/agentes.ts:17`).
- `0048_ligacoes.sql`:
  - **`ligacoes`** via `nod_escopar_tabela`, `CHECK (visibility='privado')`, só colunas tipadas: agente, conversa, estado (`chamando|em_curso|encerrada|nao_atendida`), `iniciada_por`, harness, modelo, provedores, voz, horários, `motivo_fim`, duração, `religacoes`, `stt_segundos`, `tts_caracteres`, custo, p50/p95, avaliação, `transcricao_apagada_em`, `resumida`. Índice único parcial `(tenant_id, owner_id) WHERE estado IN ('chamando','em_curso')`.
  - **`ligacao_falas`**: `seq`, autor, `tipo` (`fala|texto|leitura`), `texto` ≤4.000, `inicio_ms`, `fim_ms`, `interrompida`, `falado_ate`, `confianca`, `UNIQUE (tenant_id, ligacao_id, seq)`.
  - `turnos.ligacao_id` com FK composta e CHECK de mão única `origem <> 'ligacao' OR ligacao_id IS NOT NULL`. `agentes.voz` e `agentes.voz_velocidade`. `preferencias.voz_consentimento_versao/em`.
  - `MOTIVOS_FIM_LIGACAO` em `motivos.ts`, com uma linha `motivo_fim_ligacao` no mapa de `motivos-enum.test.ts:28-46`.
- `0050_bot_enum.sql` (feita na fase 5, emenda de 2026-10-04: a fase 3 não precisou): `kind_proposta` e `tipo_decisao` ganham `bot` (`agentes.ts:21,28`; `TipoDecisao` em `decisao.ts:4-15`).
- `0049_onboarding.sql` (fase 5): `preferencias` ganha etapa, `onboarding_guia_id`, `onboarding_bot_id`, conclusão, apelido, origem e tamanho do time. Backfill entre NO FORCE/FORCE (regra da 0005): quem já tem bot ou chave de máquina é marcado como concluído.
- **Eventos:** `KindEvento` ganha `ligacao_iniciada`/`ligacao_encerrada`, e o frame `ligacao.mudou` entra em `FRAME_POR_EVENTO`. Falas nunca vão para `trilha`, `events.dados`, outbox nem frames.
- **Recusas:** DTO `RecusaLigacao` com 200 em `GET /ligacoes/disponibilidade`. Limites usam o `limite_atingido` existente. Nenhum `CodigoErro` novo.
- **Histórico:** a mensagem `sistema` `{kind:"ligacao", ligacaoId, duracaoMs}` (`mensagem.ts:24`) é criada no início, já lida, e atualizada no fim, para ficar antes das ações. Ligação não atendida também ganha linha. A religação continua a mesma linha.
- **Resumo:** se a ligação acaba sem resumo (queda, deploy, lease), um turno sem ferramentas resume as últimas 60 falas. Até ele assentar, `emitirPlanoTurno` põe as 20 últimas falas no `contextoConversa`.
- **Apagar:** a dona apaga como `nod_app` (policy `nod_pessoa_delete`). A tela avisa que o resumo fica. Não há poda automática (`NOD_LIGACAO_RETENCAO_DIAS` vazio = desligado); ligar só com decisão escrita na ADR-075.
- **Tela:** frames de turno levam `origem`. A web ignora `ligacao` no bloco vivo, na fila, no Parar e na Frota (`reducer.ts:336-375,486-488`, `conversa.ts:517-522`) e mostra "Em ligação". `lerConversa` (`enviar-mensagem.ts:140-142`) e `pendentesRenderizaveis` (`turnos.repo.ts:465-471`) excluem `ligacao`.
- **Parar:** `parar` exclui `origem='ligacao'` (`parar.ts:38-39`). Ligar e cada vez da pessoa chamam `paradas.encerrarAbertas`.

### Voz por bot

- `VOZES_NOD` (`src/contracts/vozes.ts`): 8–12 vozes Chirp 3 HD escolhidas no teste cego. `src/adapters/voz/catalogo-vozes.ts` liga cada id ao provedor.
- `agentes.voz` nulo usa um hash do id. `proximaVoz` faz rodízio ao lado de `proximaForma`/`proximaCor` (`proposta-agente.ts`). A voz é copiada em `duplicar-agente.ts`.
- Escolha com prévia em `novo-bot.ts`, `detalhes.ts`, no card do `propor_bot` e em Ajustes da ligação. Ajustes tem voz e velocidade 1x/1,25x/1,5x (Chirp `speakingRate`); a troca vale na próxima frase.

### Onboarding por ligação

1. **"olá"**, decidido por `preferencias` em `resolverInicio` (`reducer.ts:611`). Nada toca antes de um clique.
2. **Executor, só se nenhuma IA estiver pronta.** Hoje `desktop/main.ts:222-227` não abre a janela. Passa a abrir com os cards e a sondar a cada 3 s, ignorando o cache de 5 min do Codex (`codex-cli.ts:66`). Handlers validados: `entrar` (`claude auth login`/`codex login`), `instalar` (página oficial do Claude; release do Codex com SHA-256 fixado), `atualizar` (`claude update`). Até a fase 4, o card ChatGPT leva ao caminho sem voz com "voz com ChatGPT em breve". `inventario.mudou` também no modo compartilhado (`compor.ts:539`).
3. **"Nina está ligando…"**: a Nina nasce (colisão de nome tratada), a ligação começa com `iniciada_por='produto'` e o CLI aquece. "Atender" é o consentimento, com a linha "sua fala é transcrita pelo Google nos EUA; nada é gravado · saber mais". Tempo máximo, recusa ou não atendida encerram o turno.
4. **Entrevista:** o orquestrador conduz as 4 perguntas e o modelo só extrai os campos (`anotar_entrevista`). Primeira fala em cache, com `[nod] você já disse: …`. Chips "Diga algo como" mandam `texto`. O apelido vai para `preferencias` e para o `pessoaNome` dos prompts; o objetivo vira memória. Origem e tamanho viram também log sem texto. Fecha com resumo e "Certo?".
5. **Configuração:** `concluir_entrevista` encolhe para a pílula. `propor_bot` usa modelos de bot do domínio (4 objetivos, cada um com app, limites e 3 rotinas). Depois, `pedir_acesso` e `criar_rotina` com `para_bot`, aceito só para `preferencias.onboarding_bot_id`; o card mostra "para o {bot}". Termina com `desligar`.
- **Modo de turno `onboarding`** (texto e voz) enquanto a etapa não for `concluida`, com as três ferramentas. "Sem voz" segue o protótipo: pula a entrevista e abre os cards com o objetivo padrão.
- **Quem pode ligar:** `NOD_LIGACAO=todas`, ou admin (`ehAdmin` extraído de `rotas/marketplace.ts:42-48`), ou `NOD_ONBOARDING_VOZ` com onboarding em curso para a Nina da pessoa.

### Segurança, LGPD e limites de custo

- **Electron:**
  - `proteger()` (`main.ts:171-172`) libera só `media` de áudio no frame de topo da janela web, na origem do servidor.
  - `nod:microfone` com `getMediaAccessStatus`/`askForMediaAccess`; entitlement `audio-input`; `NSMicrophoneUsageDescription` via `mac.extendInfo`.
  - Ponte `microfone()` e `emLigacao(ativa)`, que desliga o throttling e liga `powerSaveBlocker`. Exceção à ADR-045 registrada na ADR-071: só com ligação aberta pela pessoa.
  - Com ligação ativa, fechar a janela pergunta "Encerrar a ligação?" (hoje `window-all-closed` sai, `main.ts:252`). Cmd+Q manda `tchau` e espera o resumo por até 5 s. Cmd+R reidrata por `GET /ligacoes/viva` + `ola{retomar:true}`.
  - Testar em build assinado com Developer ID.
- **Canais:** 64 KB por mensagem, ~2 KB por quadro, `bufferedAmount`. `src/adapters/voz/` não importa banco (eslint + `fronteiras.test.ts`; `scripts/desktop/build.mjs:9` recusa a pasta).
- **Google** só no servidor: conta `nod-vm` com `roles/aiplatform.user` e `speech.googleapis.com` para a reserva (`provisionar.sh:13-15,74-76`).
- **Sem áudio gravado** em banco, disco ou log. Log sem texto falado, com teste.
- **LGPD:** consentimento versionado (no onboarding é o "Atender"; fora dele, "Concordo e ligar" na primeira ligação). A versão sobe quando muda o provedor. CDPA com a seção Brasil; STT sem data logging; Vertex com retenção zero (confirmar na fase 0). Sem identificar quem fala e sem clonar voz. Bots da equipe: ligação recusada na v1.
- **Limites** (definido em 2026-10-04, por env): 30 min por ligação; 60 min por pessoa por dia no fuso `America/Sao_Paulo`, sem contar o onboarding; 20 simultâneas em memória. Custo gravado em cada ligação. Chave de admin em tempo de execução (`POST /admin/voz/desligar`), acionável pelo alerta de orçamento. Alerta no Cloud Billing; cotas do Google como última barreira.
- **`/metrics` e `/api/metrics` públicos** (`servidor.ts:40`, `compor.ts:610`) vazam `tenant_id`/`pessoa_id`: fechar no Caddyfile na fase 1.

### Operação

- **Drenagem:** no SIGTERM (`src/adapters/http/server.ts`), recusa ligação nova e avisa as vivas. Espera até `NOD_DRENAGEM_MAX_MS` (10 min) antes de `fechar()`. `stop_grace_period: 11m` em `compose.yml`. Ligação que sobrar religa sozinha na mesma linha, com as últimas 30 falas. No boot, linhas vivas sem `LigacaoViva` fecham com `reinicio_servidor`.
- **Caddy:** o bind de arquivo único fica no inode antigo (`compose.yml:30`). `deploy.sh` recria o container do Caddy só quando o Caddyfile muda, fora de ligação.
- **Quedas:**
  - Cérebro: aviso, 20 s, até 2 religações. `aposQuedaDaMaquina` (`interromper-por-maquina.ts:129`) não cria "Retomar" para ligação.
  - Travado (nada em 8 s, sem ferramenta) ou limite da assinatura (`rate_limit_event`; `account/rateLimits`): aviso falado e escrito, fim com motivo próprio.
  - TTS 429/5xx: uma nova tentativa, depois só legenda + chat. STT fora: reconecta, depois pede para digitar.
  - Renovação: `renovar` propaga `FalhaPonte.codigo` (`ponte-http.ts:32-39,54`). No turno de ligação, falha de transporte é tolerada por 20 s; 401/403/`{ativo:false}` param na hora. `RespostaRenovar.ligacaoEncerrada` vem montada em `ponte-interna.ts:107-133`.
- **STT:** rotação antes dos 10 min. Abre a sessão nova, espera `setup_complete` e só então fecha a antiga.
- **Cotas:** Chirp 3 HD tem 200 pedidos/min. Limitador com prioridade conteúdo > leitura > prévia. Pedir aumento antes da fase 6.
- **Medição:** log `ligacao_vez` sem texto (fim da fala, vez, STT final, primeiro delta, primeiro trecho, primeiro áudio, primeiro som, espera). p50/p95 na tabela `ligacoes`. Raio-X ganha `initEm`/`primeiroDeltaEm` (`raio-x.ts:37`). Nada novo no `/metrics`.
- **Env:** `NOD_LIGACAO` (`desligada|admins|todas`), `NOD_ONBOARDING_VOZ`, `NOD_VOZ_STT/TTS/PROJETO/LOCAL/PADRAO`, `NOD_MODELO_LIGACAO_*`, limites, `NOD_DRENAGEM_MAX_MS`.

## Fases

**Fase 0: sondas e medições** (1 semana; teste cego começa junto)
- **Objetivo:** números reais por etapa antes de construir.
- **Entregas:**
  - `scripts/sonda-ligacao-claude.ts`: interrupção com e sem `cancel_queued` (geração, MCP, Bash); `MAX_THINKING_TOKENS=0` contra `--thinking`; fronteira dinâmica com `--system-prompt` e com append; `--no-session-persistence`; `ENABLE_TOOL_SEARCH=false`; TTFT frio e quente (Haiku, Sonnet 4.6, Sonnet 5.5) com 0 e 2 apps; `claude auth login`/`update`. Grava `s8-ligacao.jsonl`.
  - `scripts/sonda-voz-google.ts` (VM e Mac em SP): parcial e final, `activityEnd` manual, rotação, cobrança do silêncio, Chirp por REST (5 palavras e uma frase), protótipo gRPC, CPU real com TLS e base64.
  - `scripts/sonda-codex-app-server.ts`: `model/list`, esforço do Luna, TTFT, `turn/steer`, `turn/interrupt`, pedidos de aprovação do servidor, `codex login`.
  - `scripts/medir-fim-de-turno.ts` (~300 falas internas): regras contra Silero + Smart Turn.
  - Bancada de AEC no Electron 43: `'all'` contra `true`; alto-falante a 50, 80 e 100%; AirPods; monitor externo.
  - Créditos, DPA, retenção zero, cotas, termos da OpenAI e confirmação escrita da Anthropic.
- **Decisões a levar ao Marlon:** retenção; para_bot contra card único (ADR-050); plano B do Codex; Ajustes e chips; caminho sem voz; perfis de gramática; leitura do texto do item; itens de terminal por voz; bots da equipe.
- **Saída:** números com data na ADR-071 e decisões escritas sobre interrupção in-band, modelo por harness, TTS REST (5 palavras ≤500 ms) ou streaming, STT, AEC ou modo fone, Smart Turn (só se ganhar ≥250 ms no p50), gRPC e Codex. Se o app-server reprovar, o Marlon decide antes do fim da fase 1, com plano B medido: `codex exec` por fala, esperas desde 0 ms, p50 ≤4,5 s.

**Fase 1: a menor ligação de verdade** (atrás de `NOD_LIGACAO=admins`)
- **Objetivo:** ligar para qualquer bot no Mac com Claude Code, conversar, interromper e desligar.
- **Entregas:**
  - **Servidor:** 0047, 0048, eventos; `ws` com upgrade (`servidor.ts:39`, `boot.ts:109`); dois canais; `aoRevogar`; orquestrador; Google com rotação; provedor falso.
  - **Conversa:** VAD, fim de turno por regras, reconhecimento e "pensando", interrupção confirmada, filtro do falável.
  - **Cérebro:** turno `ligacao` com capacidade anunciada; `montarArgsLigacao`; prompt; catálogo; continuações como `nota`; tolerância na renovação; Parar e paradas.
  - **Mac e web:** Electron (permissão, entitlement, Info.plist, ponte, fechar janela); tela cheia; botão "Ligar"; tela ignorando o turno `ligacao`; "Chat de voz"; transcrição; resumo, inclusive o de queda.
  - **Governança:** consentimento, limites, chave de admin, recusas tipadas; fechar `/metrics`; Caddy no deploy; AGENTS.md; ADR-071, ADR-072 e ADR-075.
- **Arquivos:** `src/adapters/voz/*`, `src/domain/ligacao*.ts`, `src/use-cases/ligacoes.ts`, `rotas/ligacoes.ts`, `claude-cli.ts`, `cerebro-ligacao.ts`, `turnos.repo.ts`, `parar.ts`, `ponte-interna.ts`, `desktop/main.ts`, `web/lib/ligacao.ts`, `web/telas/ligacao.ts`.
- **Saída:**
  - `npm run check` verde com `ligacao-catcher`.
  - 3 pessoas, ligações de 12 min atravessando a rotação, ≥20 trocas e 5 interrupções, sem queda; turno `concluido`.
  - Primeiro som p50 ≤1,0 s; conteúdo p50 ≤2,5 s; volume abaixa ≤150 ms.
  - `carga-voz.ts` com 10 ligações: CPU <50%, atraso <200 ms.

**Fase 2: parecer ligação** (admins)
- **Objetivo:** conversa completa, voz por bot, resistência a queda e deploy.
- **Entregas:** esperas completas, backchannel, "ouviu até", eco, refazer a vez, segmentador com corpus, léxico, ociosidade, `devicechange`; reconexão e drenagem; pílula; voz por bot com Ajustes de voz e velocidade; provedor vencedor; Smart Turn e streaming se a fase 0 mandar; ADR-073.
- **Saída:** conteúdo p50 ≤2,0 s e p95 ≤3,0 s; interrupção falsa e perdida ≤5% a 70% de volume; corte no meio da frase ≤5% em 100 turnos; nenhuma espera repetida em 60 s; 30 min sem queda; deploy no meio drena; troca de provedor só por env.

**Fase 3: agir na ligação** (admins)
- **Objetivo:** o bot faz enquanto conversa, e a pessoa aprova falando.
- **Entregas:** 0049; `iniciar_tarefa`, `mandar_no_chat`, `desligar`, `propor_bot` (catálogos `ligacao` e `conversa`) em `src/contracts/ferramentas-ligacao.ts`; notas de tarefa e de colega; aprovação e resposta por voz com `comandoId`; `pedir-a-bot.ts` lê `ligacao_falas`; ADR-074.
- **Saída:** e2e `pedir_aprovacao` → "eu aprovo" → executado e falado; "recuso" num card `aprovacao` recusa todos os itens; "revisa o PR" segue a conversa e avisa "terminei"; voz nunca cria "Sempre permitir"; ≥30 casos de gramática; 50 tentativas de eco com zero aprovação.

**Fase 4: Codex pelo app-server** (em paralelo à 3; admins)
- **Entregas:** driver e parser; launcher comum; respostas negando pedidos do servidor; piso de versão; cenário em `tests/fixtures/codex-falso.mjs`; `harness.ts`; ADR-076.
- **Saída:** e2e com o Codex falso; 10 min manuais; conteúdo p50 ≤3,0 s e p95 ≤4,5 s.

**Fase 5: onboarding "Proposta 2"** (atrás de `NOD_ONBOARDING_VOZ`)
- **Entregas:** 0049 com backfill e 0050 (enum `bot`); "olá"; cards de IA com handlers; toque com aquecimento; modo `onboarding`; roteiro conduzido; `anotar_entrevista`/`concluir_entrevista`; `para_bot`; chips; caminho sem voz; ADR-077.
- **Arquivos:** `web/estado/reducer.ts`, `desktop/main.ts`, `rotas/ponte.ts`, `prompt-ligacao.ts`, `src/use-cases/propor-bot.ts`, `pedir-acesso.ts`, `web/telas/onboarding.ts`.
- **Saída:** 10 pessoas internas novas terminam por voz com 1 bot, 1 app e 1 rotina do bot novo (mediana ≤8 min, máximo 10); "sem voz" e "sem IA" terminam; nenhum silêncio >2 s fora do login; usuários antigos não veem o onboarding.

**Fase 6: entrada no ar** (`NOD_LIGACAO=todas`)
- **Entregas:** cotas aumentadas, alerta de orçamento ligado à chave de admin, consentimento final, DPA, runbook em `docs/deploy-gcp.md`.
- **Saída:** carga com 20 ligações; alerta disparado num teste desliga a voz; limites aplicados no e2e.

## Arquivos críticos e reuso

**Novos**
- Domínio puro, plano, `agora` por parâmetro: `src/domain/{ligacao,ligacao-turno,ligacao-espera,ligacao-frases,ligacao-ouvido,ligacao-eco,ligacao-vad,comando-de-voz,leitura-aprovacao,prompt-ligacao,roteiro-onboarding,modelos-de-bot,codex-app-server}.ts`.
- Contratos (<200 linhas cada, EMENDA 26): `src/contracts/{voz,ligacao,vozes,ferramentas-ligacao}.ts`.
- Voz, sem banco: `src/adapters/voz/{spi,ws,orquestrador,vad,google-transcricao,google-voz,token-google,voz-falsa,falas-de-espera,catalogo-vozes}.ts`.
- Servidor: `src/use-cases/ligacoes.ts`, `src/repositories/ligacoes.repo.ts` (registrado em `index.ts`/`tipos.ts`), `src/adapters/http/rotas/ligacoes.ts`, migrações 0047–0050.
- Mac: `src/adapters/executor/cerebro-ligacao.ts`, `drivers/codex-app-server.ts`, `desktop/permissoes-midia.ts`, `desktop/instalar-ia.ts`.
- Web: `web/lib/ligacao.ts`, os dois worklets, `web/telas/ligacao.ts`, `web/telas/onboarding.ts`.
- Scripts: `scripts/sonda-{ligacao-claude,voz-google,codex-app-server}.ts`, `medir-fim-de-turno.ts`, `carga-voz.ts`, `teste-cego-voz.ts`.

**Alterados**
- HTTP: `servidor.ts:31,39`, `boot.ts:109,187`, `roteador.ts:108-153`, `compor.ts` (`criarVoz`, `inventario.mudou`), `server.ts` (drenagem).
- Fila e ponte: `turnos.repo.ts:170,465-471`, `despachar-turno.ts:36`, `sessao-viva.ts:38-40`, `rotas/ponte.ts:84-85`, `ponte-validacao.ts`, `ponte-interna.ts:87-92,107-133`, `src/contracts/ponte.ts`, `src/services/token-turno.ts`.
- Plano e prompt: `contracts/plano-turno.ts:12`, `domain/plano-turno.ts:75,166-180`, `emitir-plano-turno.ts:63,109,126,217`, `nativas.ts:55-80`, `modo-aprovacao.ts:35`, `prompt-sistema.ts:54,182,304`, `contracts/turno.ts:27`, `schema/agentes.ts:17`.
- Executor: `claude-cli.ts:145,207-223,373-393`, `spi.ts:47`, `laco.ts:141`, `ponte-http.ts:32-54`, `catcher.ts`, `stream-json.ts:53`, `flag-floors.ts`, `codex-cli.ts:36-94`.
- Decisões: `rotas/decisoes.ts:88-145`, `decidir.ts:69,251`, `decidir-acesso.ts:104`, `responder-decisao.ts:33`, `decisoes.repo.ts:161`, `enfileirar-retomada.ts`, `parar.ts`, `interromper-por-maquina.ts:129`, `proxy.ts:53,169`, `pedir-acesso.ts`, `criar-rotina`.
- Desktop: `main.ts:171-172,222-227,252`, `preload-web.ts`, `contracts/desktop.ts`, `entitlements.mac.plist`, `electron-builder.yml`.
- Web: `index.html:23-24`, `main.ts:188,740-743,1119,1269,1566,1822`, `reducer.ts:336-375,486-488,611`, `conversa.ts:83,421,514-522`, `relogio.ts`, `mascote.ts`.
- Infra e config: `vite.config.ts` (entrada `ws:true` antes de `"/api"`, com `changeOrigin:false`), `eslint.config.mjs`, `provisionar.sh`, `infra/gcp/vm/{Caddyfile,compose.yml,deploy.sh}`, `THIRD_PARTY_NOTICES.md`, `AGENTS.md`.

**Reaproveitar**
- `mensagemClaude`, `receberMensagem` (`claude-cli.ts:287`), `classificarSessao`, `conferirFloors`, `montarEnvDoFilho`.
- `despacharTurno`, `emitirPlanoTurno`, `assentarTurno`, `tokenTurno`, `paradas.encerrarAbertas`, `turnos.contaminar`.
- `marcarEDecidir`, `executarItens`, `assentarAprovacao`, `decidirAcesso`, `confirmarProposta`, `redigirDesfechoAprovacao`.
- `barramento.inscrever`, `rotuloFerramenta`, `comandoArriscado`, `neutralizarDelimitadores`, `redigir`, `abrirTxEscopada` (`src/db/tx.ts:51`), `nod_escopar_tabela`, `ErroDeDominio`, `log`.
- `ehAdmin` (`marketplace.ts:42-48`), `proximaForma`/`proximaCor`, `preferenciasRepo`.
- Padrão `#espaco`/`renderEspaco`, `remetenteWebValido` (`desktop/avisos-mac.ts:22`), `criarCanalAvisos`, `regiaoPorBlocos`, `htmlMascote`.
- Testes: `servidor-completo.ts`, `with-rollback.ts`, `catcher-roteiro.ts`, `claude-falso.mjs`, `codex-falso.mjs`, `gate-rls.ts`, `conceder-so-pela-pessoa.test.ts`.

## Verificação

- **Unit** (relógio falso):
  - todas as regras `ligacao-*`, `comando-de-voz` (perfis, negação, `comandoId`) e `leitura-aprovacao` (limites, contaminado);
  - argv e ambiente de `montarArgsLigacao`; prompt sem "Formatação";
  - `stream-json` com `s8`: capacidades e `control_response` por `request_id`;
  - `laco` (tolerância por código; 401 para); `cerebro-ligacao`;
  - orquestrador com provedores falsos: vez, espera, interrupção, janela, fila de decisões, notas, queda, rotação, drenagem;
  - `permissoes-midia`; parser do app-server.
- **Integration** (`withRollback`):
  - `ligacoes`: recusas, uma viva por pessoa, linha criada no início, religação na mesma linha, apagar, RLS negativa;
  - plano de ligação: sem terminal, sem sessão da conversa, conectores com teto;
  - `decidir` com `canal:"voz"`: mesmas linhas do clique, recusa via itens desmarcados, sem `sempre`;
  - `parar` poupa a ligação; turno de `iniciar_tarefa` com `conversaComAPessoa` falso;
  - resumo de queda; backfill da 0049; log sem texto falado.
- **Conformidade:** RLS das tabelas novas; `motivo_fim_ligacao` no mapa de `motivos-enum.test.ts`; `fronteiras.test.ts` com `src/adapters/voz`; teste novo "nenhuma ferramenta de ligação decide", no modelo de `conceder-so-pela-pessoa.test.ts` + `eslint.config.mjs:100-117`.
- **Concurrency** (custo zero):
  - `tests/concurrency/ligacao-catcher.test.ts`: `servidorCompleto`, catcher em modo ligação, voz falsa, cliente WS com cookie e `Origin`. Fluxo ligar → saudação → fala → interromper → "eu aprovo" → `iniciar_tarefa` → desligar → linha, resumo, `concluido`. Casos extras: `Origin` inválido, Parar no meio, drenagem, religar.
  - `reivindicar` com ligação e trabalho do mesmo bot, no padrão de `serializacao-por-conversa.test.ts` (ADR-010).
- **Sondas pagas:** só `scripts/sonda-*.ts`, à mão.
- **Latência:**

| Medida | Meta |
|---|---|
| Vez decidida | p50 ≤600 ms (≤300 ms com Smart Turn) |
| Primeiro som | p50 ≤1,0 s; p95 ≤1,5 s |
| Conteúdo Claude / Codex | p50 ≤2,0 / 3,0 s; p95 ≤3,0 / 4,5 s |
| Sem som e sem mudança na tela | nunca >1,5 s |
| Interrupção | volume ≤150 ms; voz cortada ≤800 ms no p90 |

  Estimativa Claude quente: 0,6 + 0,03 + 0,7–0,9 + 0,15 + TTS 0,35–0,55 + 0,1 ≈ 1,9–2,4 s.
- **Carga:** `carga-voz.ts` com 10 e 20 ligações; `scripts/carga-tela` após mexer em `web/main.ts` (ADR-061).
- **Manual no Mac** (build assinado): permissão concedida e negada; saídas de áudio a 50/80/100%, AirPods conectando no meio; "uhum" não interrompe; 20 interrupções; falar durante ferramenta; criar rotina e aprovar e recusar por voz; e-mail lido com "eu aprovo" não aprova; Wi-Fi fora 5 s e 30 s; tampa fechada; Cmd+R; fechar a janela; deploy e Parar no meio; Mac Intel; no macOS 12 só a recusa escrita (o Claude Code exige 13+).
- **Teste cego** (semanas 1–2, gravações internas consentidas):
  - STT: Transcribe Live × Chirp 3 × Soniox × Scribe, por WER com jargão do nod, latência e custo;
  - TTS: Chirp 3 HD × ElevenLabs × Soniox × Gemini 3.8, por MOS (≥5 ouvintes, 25 frases), latência e custo;
  - o resultado vira emenda da ADR-071.

## ADRs novas

1. **ADR-071, modo ligação:** voz no processo do nod, cérebro no Mac, nod-voz/1, drenagem, `ws`, exceção do `powerSaveBlocker`, cache de clipes. Emenda as ADRs 001, 014 (EMENDA 11), 016, 020, 021, 026 e 067.
2. **ADR-072, laço de voz:** turno `ligacao` fora da serialização, sessão efêmera, modelo por harness, continuações como nota, `iniciar_tarefa` com `ligacao_id`. Emenda as ADRs 010, 036, 045 e 047.
3. **ADR-073, camada de conversa pt-BR:** VAD, fim de turno, interrupção, esperas, eco, metas.
4. **ADR-074, aprovação e resposta por voz:** perfis de gramática, `comandoId`, `canal:"voz"`, exclusões, eco. Emenda as ADRs 007 e 029.
5. **ADR-075, dados e LGPD:** `ligacoes` + `ligacao_falas`, sem áudio, consentimento no "Atender", sem poda por padrão. Refina as ADRs 002 e 005.
6. **ADR-076, Codex pelo app-server** só na ligação; fecha o "Não implementado" da ADR-067.
7. **ADR-077, onboarding por ligação:** modo `onboarding`, `propor_bot`, `para_bot`, cards de IA. Segue a ADR-050 e emenda a ADR-059.

## Riscos e plano B

| Risco | Mitigação |
|---|---|
| Haiku 4.5 aposentado (não antes de 2026-10-15) | Feito na NOD-164: o padrão é o Sonnet 4.6 sem thinking adaptativo; Sonnet 5.5 low pela config do servidor se a sonda medir dentro do corte |
| Interrupção in-band falha com ferramenta | Só modo suave: calar a voz e mandar "ouviu até" |
| Transcribe Live sem SLA, sessão de 10 min | Rotação desde a fase 1; Chirp 3 (gRPC) pela mesma SPI |
| TTS REST lento ou cota de 200/min | Limitador com prioridade, streaming gRPC, aumento de cota, clipes em cache |
| Provedor fora | Nova tentativa, depois só legenda + chat; STT fora pede para digitar |
| AEC fraco no MacBook | `'all'`, limiar maior, confirmação por palavras, fone; plano B meio-duplex com interrupção por botão ou espaço |
| Corte no meio da frase | Pistas de texto e corpus; Smart Turn num worker (traz onnxruntime) |
| e2-medium engasga | Carga em cada fase, buffer no cliente; VM maior ou mídia em processo próprio |
| Deploy derruba ligação | Drenagem, religar na mesma linha, resumo de queda, deploy fora do horário comercial |
| Laço de voz e trabalho do mesmo bot juntos | Origem própria, testes de concorrência, notas só do `ligacao_id`, absorção desligada |
| Eco ou alguém ao lado aprova | Janela pelo VAD, gramática fechada, leitura do servidor, `comandoId` de uso único; risco residual aceito |
| Eco de conteúdo de fora vira pedido | Só palavras de parada durante leitura não confiável; `conversaComAPessoa` falso |
| App-server do Codex experimental ou reprovado | Piso de versão e sonda; plano B `codex exec` por fala, decidido pelo Marlon; card ChatGPT sem voz |
| Política da Anthropic ou da OpenAI muda | Prompt curto, custo no Raio-X, confirmação escrita dos dois |
| Limite da assinatura ou cérebro travado | Aviso falado e escrito e fim com motivo próprio |
| Gasto descontrolado | Limites no app, chave de admin, alerta de orçamento, 1,2× tempo real fecha |
| Voz como dado sensível | Consentimento, nada gravado, transcrição apagável; Azure Brazil South como plano B |
| O Mac dorme | Aviso, 20 s, religar; sem máquina, `cerebro_caiu` com resumo de queda |

## Fora da v1

- Ligação pelo celular (o canal já funciona no navegador; faltam a interface móvel, o estado "Mac dormindo" e o AEC no Android).
- WebRTC/TURN, serviço de voz separado, GPU e modelos abertos.
- Voz exclusiva (Gemini 3.8 TTS), clonagem, idiomas além do pt-BR.
- Bot que liga sozinho fora do onboarding, ligação com vários bots, ligação em conversa de equipe, voz nativa do Codex.
- VAD no cliente para economizar STT, Opus no Mac.
- Métricas novas no `/metrics`, gravação de áudio, poda automática sem decisão.
