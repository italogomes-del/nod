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
