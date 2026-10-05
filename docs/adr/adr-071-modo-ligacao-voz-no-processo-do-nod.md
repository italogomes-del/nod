# ADR-071 — Modo ligação: a voz roda no processo do nod, o cérebro no Mac

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md)

## Decisão

Todo bot atende **ligação por voz**. A voz (ouvir, decidir a vez, falar) roda **dentro do processo do nod**, em
TypeScript (`src/adapters/voz/`); o cérebro é o executor que a pessoa já tem no Mac (Claude Code ou Codex), num turno
próprio (ADR-072).

```
renderer (microfone, AEC, alto-falante) ══ WSS mídia ══▶ orquestrador (VAD, vez, esperas, interrupção) ──▶ provedor STT/TTS
executor do Mac (claude -p | codex app-server) ══ WSS cérebro (o Mac disca) ══▶ orquestrador
```

- **Protocolo `nod-voz/1`** (`src/contracts/voz.ts`): mídia em `/api/t/:tenant/voz/v1/midia` (cookie da sessão, `Origin`
  do mesmo host, PCM16 16 kHz subindo e 24 kHz descendo em quadros binários) e cérebro em `/api/interno/voz/v1/cerebro`
  (sem `Origin`, token do turno no Bearer — as regras do roteador valem no upgrade).
- **Provedores plugáveis** (`src/adapters/voz/spi.ts`): `google` (Transcribe Live + Chirp 3 HD, pago pelos créditos do
  projeto — quadro de custos em docs/plano-modo-ligacao.md), `local` (whisper.cpp + `say`, grátis, só em dev no Mac) e
  `falso` (testes). `NOD_VOZ_STT`/`NOD_VOZ_TTS` escolhem; voz mal configurada deixa a ligação indisponível sem derrubar
  o servidor.
- **`ws`** é a segunda dependência de runtime (servidor WebSocket em JS puro, sem nativo); o cliente do Mac usa o
  `WebSocket` global.
- **Nenhum áudio é gravado** (banco, disco, log). O texto falado nunca vai para log.
- **Drenagem:** no SIGTERM o nod recusa ligação nova, avisa as vivas falando e espera até `NOD_DRENAGEM_MAX_MS`
  (10 min; `stop_grace_period: 11m`). O Caddy preserva os WebSockets num reload (`stream_close_delay`) e só é recriado
  quando o Caddyfile muda.
- **Exceções registradas:** `powerSaveBlocker` só com ligação aberta pela pessoa (emenda a alternativa descartada da
  ADR-045); a página do app ganha **só** a permissão de microfone, só de áudio, só na origem do servidor (emenda a
  ADR-020/`proteger`); o laço de voz usa um diretório estável por bot (emenda a EMENDA 11 da ADR-014); clipes de espera
  ficam num cache refazível fora do `NOD_HOME`.

## Por quê

A experiência depende do cérebro (segundos) e da camada de conversa, não do processo onde a voz roda; o plano e o token
do turno já vivem na memória do nod (ADR-024). Separar a voz num serviço próprio não salvaria a ligação num deploy e
traria porta, JWT e outro runtime. GPU própria só compensa com milhares de pessoas (custos no plano).

## Alternativas rejeitadas

- **Pipecat em Python num container ao lado.** Segundo runtime e autenticação própria; fica como saída pelo mesmo
  protocolo se a CPU da VM não der conta.
- **Voz no Mac.** Download de modelos e qualidade pior; a credencial do Google não pode ir ao app.
- **Speech-to-speech pronto (GPT-Live, Agents).** Parafraseia o cérebro e custa 2,5–4× uma cascata.

## Gatilho de revisão

`scripts/uat/ligacao-voz.ts` ou a carga mostrar CPU acima de 50% com 10 ligações na e2-medium, ou a conta de voz passar
de ~US$ 5 mil/mês por 2–3 meses (GPU própria passa a valer).

## Emenda 2026-10-04 — a voz do Google sai em streaming

**O que muda.** O TTS Chirp 3 HD passa a usar o streaming (`StreamingSynthesize`), que devolve áudio conforme
sintetiza. O REST, que só devolve a frase inteira, fica de rede de segurança: entra quando o streaming falha antes de
entregar áudio (prazo de 3 s, erro de rede, `grpc-status` diferente de 0) e direto por 5 min depois de 3 falhas
seguidas. `NOD_VOZ_TTS_STREAMING=0` volta ao REST puro.

**Como.** O método só existe em gRPC. Em vez de `@grpc/grpc-js`, o gRPC vai direto sobre `node:http2`, com as três
mensagens protobuf escritas à mão (`src/adapters/voz/google-voz-streaming.ts`) e transporte injetável — o mesmo estilo
do STT, que fala a Live API em WebSocket cru. O projeto segue com duas dependências de runtime. Um fluxo por trecho da
fila: configuração e texto num envio só, e o servidor responde com o áudio.

**Medido em 2026-10-04** (`scripts/voz/sonda-tts-streaming.ts`, de um Mac no Brasil; a VM de produção fica em
southamerica-east1), voz Erinome:

- REST: primeiro áudio em 1,2–2,8 s (mediana ~2,0 s).
- Streaming no endpoint global: duas faixas, ~0,35–0,5 s e ~1,15–1,3 s, mais ou menos metade em cada (9 de 16 abaixo
  de 0,7 s numa rodada em sequência). Não achei como escolher a faixa: não depende da frase, da pausa entre pedidos,
  de mandar o fecho junto com o texto, nem de abrir dois fluxos iguais (nunca os dois saíram rápidos).
- Endpoint `us-`: fixo em ~0,87 s. `eu-`: ~1,74 s. Não existe endpoint regional de São Paulo para este método.
- A síntese inteira sai 5 a 8 vezes mais rápido que a fala; maior intervalo entre pedaços, ~120 ms.
- No UAT do onboarding (voz do Google, `fable`, 5 vezes por rodada): do primeiro trecho ao primeiro áudio, de
  1,0–1,9 s (REST, uma rodada) para 0,3–2,0 s (streaming, duas rodadas); o silêncio do fim da fala ao primeiro som
  caiu de p50 4,1 s para 3,4 s numa rodada e 2,9 s na outra. Com a guia falando antes de anotar (emenda da ADR-077),
  o caminho inteiro foi de 5,2 s a cerca de 3 s. Numa das rodadas um fluxo estourou o prazo (2,5 s na época) e caiu
  no REST sozinho.

**No orquestrador.** Com a voz em streaming, a fala de espera "pensando" não toca se o conteúdo já está sendo
sintetizado há menos de 1,5 s. O primeiro pedaço de cada trecho só sai com 400 ms de áudio juntos, para o app não
dar a fala por terminada logo no começo (ele faz isso com 200 ms de fila vazia, e o UAT viu 332 ms entre dois pedaços).

**Alternativas rejeitadas.** `@grpc/grpc-js` (dependência e transitivas para uma chamada só). Fixar o endpoint `us-`
(previsível, mas mais lento que a média do global). Abrir dois fluxos e ficar com o primeiro (dobra os caracteres e os
pedidos contra a cota de 200 por minuto, e não saíram independentes).

**Gatilho de reversão.** Se o log `voz_tts_streaming_falhou` aparecer em mais de 1 em cada 20 trechos, ou se a sessão
HTTP/2 crua der trabalho (GOAWAY, fluxos presos), troca-se o transporte por `@grpc/grpc-js` atrás da mesma interface;
se o problema for do serviço, `NOD_VOZ_TTS_STREAMING=0`.

**A confirmar.** Se `speaking_rate` é honrado no streaming e se cada fluxo conta na cota de pedidos por minuto.

## Emenda 2026-10-05 — a drenagem cobre os turnos em execução (NOD-175)

**O que muda.** Definido em 2026-10-05: no SIGTERM a drenagem deixa de proteger só as ligações. Com o mesmo prazo
(`NOD_DRENAGEM_MAX_MS`, 10 min) o nod também:

- **para de entregar turno novo aos Macs.** O `POST /api/maquina/puxar` volta `{plano:null}` na hora, na entrada e a
  cada volta do long-poll. O turno fica `pendente` no Postgres (ADR-010) e o próximo processo o entrega. `renovar` e
  `entregar` seguem aceitos.
- **espera os turnos com token vivo** (`tokenTurno.ativos()`) e as reservas em voo da ponte, só no modo compartilhado.
  No modo local o turno roda no próprio processo e o Ctrl+C não pode travar 10 min, então ali a espera continua só pelas
  ligações.

**Corrida entre a reserva e a drenagem.** A ponte conta os `ponte.puxar` em voo (`reservasEmVoo()`). Um plano reservado
antes da drenagem e devolvido já durante ela **é entregue**: o token foi cunhado e passa a contar em `ativos()`. Uma
reserva feita nunca é desfeita, e a drenagem só termina com esse contador em zero.

**O que passa do prazo.** `fechar()` não revoga nada. O próximo boot assenta o turno remanescente como
`reinicio_servidor` pelo varredor de lease (ADR-045) e o aviso sai como hoje.

**Como.** `ServidorNod.drenar({prazoMs, intervaloMs})` (boot.ts) espera e devolve o resultado; `server.ts` faz
`drenar().then(fechar)`. Log `drenagem_concluida {vivas, turnos, duracao_ms, prazo_vencido}`. O segundo sinal mata pelo
padrão do Node (`process.once`).

**Saúde.** `/api/saude` faz `select 1` com prazo de 2 s. Se falhar, devolve 503 `{ok:false}`, sem detalhe (log
`saude_banco_falhou {motivo}`). Na drenagem continua 200: o banco segue no ar e o container só deve sair pelo SIGTERM.

**Custo aceito.** Um deploy com uma sessão viva longa congela a entrega de turnos novos por até 10 min. Um token órfão
(rollback depois do `cunhar`) segura a drenagem até o prazo, sem perder turno. A medida é
`pos_restart{desfecho="perdido",origem="restart_servidor"}` por deploy, antes e depois, junto com
`drenagem_concluida.duracao_ms`.
