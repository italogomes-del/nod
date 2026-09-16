# ADR-016 — SSE com frames numerados, buffer de replay POR TENANT, e reidratação por snapshot com o stream como barreira

**Frente** Tempo real · **Status** decidido · **Épicos** E3, E4, E5, E7, E8, E9, E12

## Decisão

SSE como transporte único servidor→cliente, com id por frame no formato <streamId>:<seq>; comandos cliente→servidor por POST. O buffer de replay é Map<tenant_id, Frame[]> — nunca global — e a função de entrega recebe o tenant do cliente como ARGUMENTO obrigatório, comparando com o tenant do frame antes do write e falhando fechado em divergência. Na reconexão: se resumed:true, aplica o replay; se resumed:false, dispara snapshot REST completo, enfileira frames que chegarem durante o voo e os aplica POR CIMA, com o cursor avançando só depois do snapshot aplicado. Nunca replay parcial, nunca merge de fila antiga. Backoff exponencial COM jitter.

## Contexto

E3 exige fila ao vivo atravessando empresas; E9 exige sobreviver a restart. A pergunta operacional é como o cliente SABE que perdeu evento — sem numeração ele não sabe, e fila de decisões que perdeu um item em silêncio é pior que fila vazia, porque parece confiável.

## Alternativas rejeitadas

### WebSocket no estilo Buzz

O custo está medido: crates/buzz-relay/src/connection.rs tem 1142 linhas para o ciclo de vida de UMA conexão (semáforo de admissão, challenge, três loops, canal de controle separado do de dados para o Ping não ficar preso atrás de buffer cheio, contador de backpressure com grace limit), mais crates/buzz-pubsub/src (2144 linhas) para o fanout Redis. E depois de tudo isso entrega MENOS garantia: buzz-relay/src/main.rs:982 mostra que quando um receptor fica para trás, o Buzz apenas incrementa um contador e loga um warn — o evento é perdido em silêncio, sem replay. O SSE do OpenMausBot cabe em ~130 linhas (server/index.ts:3005-3060 e :11616-11686) mais server/sse-fanout.ts (67 linhas) e nunca perde evento durável em silêncio.

### Polling REST

A tese é relógio real com expiração. Polling de 5s custa 70 clientes x N abas batendo no Postgres sem nada novo a dizer, e a fila fica até 5s atrasada em relação ao prazo que ela mesma mostra.

### Supabase Realtime

Entrega mudanças de LINHA, não eventos de domínio tipados. E4 precisa de item de aprovação com justificativa e E8 de trilha do que foi negado — são eventos com semântica, não diffs de tabela. Colar a projeção do cliente no formato físico das tabelas trava a evolução do schema, e a granularidade de RLS em Realtime vira um segundo lugar onde o isolamento pode vazar.

### Buffer de replay global, como o código de referência

É o buraco mais grave do desenho copiado. server/index.ts:3029-3057 mantém UM replayBuffer global e itera sobre TODOS os sseClients, com a única discriminação sendo client.admin ? frame : clientFrame. Não existe tenant nesse caminho. No nod, o SSE é o único lugar onde o dado atravessa para fora do servidor — a RLS já ficou para trás. Um frame de decisão entregue ao cliente errado é vazamento entre empresas, e o buffer retém isso em RAM por até 500 frames, sem aparecer em nenhum inventário e sem ser apagável por pedido de exclusão.

### Replay parcial na melhor tentativa

Parece gentil e é a mais perigosa. server/index.ts:11642-11644 diz por quê numa frase que vale adotar como regra: 'Se o cursor do cliente caiu fora do buffer, dizer isso é a única resposta honesta — um replay parcial deixaria um buraco permanente no estado dele.'

### Mesclar o estado local antigo com o snapshot novo

É o instinto errado mais caro. Depois de 8 horas, itens SUMIRAM da fila — foram decididos por outra pessoa, o workspace revogou acesso. Merge por id preserva o que sumiu, porque ausência não é fato que o merge observe. Resultado: fila com fantasmas ainda clicáveis. Substituição total é a única semântica correta para lista cuja ausência tem significado.

## Evidência

server/index.ts:3005-3010 define STREAM_ID = randomUUID().slice(0,8) e REPLAY_MAX = 500, com o comentário explicando o streamId: 'as sequências recomeçam em 1 no boot, então um cursor de uma execução anterior tem que ser rejeitado em vez de reproduzir os frames de outra execução' — resposta direta a E9. A condição de aceitação do resume (index.ts:11645-11648) é sutil: replayBuffer[0].seq <= since + 1, aceita só se o buffer alcança o PRÓXIMO frame que falta. Frames 'screen' guardam o slot de sequência mas descartam o payload base64 (index.ts:3046-3047), para a detecção de gap continuar honesta sem reter megabytes. No cliente: src/state/store.tsx:3078-3110 implementa a barreira ('Um snapshot e a dobra ao vivo têm que se encontrar numa fronteira definida'), e src/lib/live-events.ts:315-317 faz a parte mais sutil — o cursor não avança no hello quando resumed é false, fica em pendingSnapshot e só é commitado depois que onSnapshotRequired resolve true. live-events.ts:271-276 só zera o backoff quando chega um PING, não no onopen: 'um evento open só prova que houve um handshake TCP; um ping prova que o stream continuou usável'. O backoff (live-events.ts:205-215, 500ms→10s) NÃO tem jitter — é a correção a levar junto.

## Consequências

- Toda ação do usuário vira POST separado. Bom para a trilha (cada decisão nasce como requisição auditável com corpo próprio), custa a latência de uma ida.
- É obrigatório verificar que o proxy do PaaS não faz buffer do stream: o OpenMausBot manda x-accel-buffering: no (index.ts:11627) justamente por isso.
- Recreate no deploy (ADR-001) invalida todos os cursores e faz todos reidratarem de uma vez — daí o jitter obrigatório, senão cada deploy vira pico sincronizado no Postgres.
- O snapshot REST da frota vira endpoint de primeira classe, rápido e paginado: é o caminho de toda abertura fria e de toda volta longa, e é onde o índice (decisor, estado, expires_at) se paga.
- A volta de segunda-feira deve mostrar o que mudou na ausência — E5 (paradas) e E7 ('não executou') só têm valor se aparecerem na volta. É consulta de servidor por período desde o último visto.
- Aba oculta não reconecta (live-events.ts:206 e :336 checam isVisible antes) — economiza conexão e bateria no celular do gestor de RH.
- Screenshot do browser de E11 não vai no stream em base64: sai por URL assinada fora do stream.

## Reversibilidade

barata para o TRANSPORTE, cara para o CONTRATO DE RESUME. O encapsulamento em src/lib/live-events.ts atrás de uma interface de 4 campos prova que trocar SSE por WebSocket é reescrever um arquivo. Mas o contrato (hello com resumed, cursor commitado só após snapshot, streamId que invalida cursor antigo) vive nos dois lados ao mesmo tempo, e retrofitar cria um período de versões incompatíveis em produção. Por isso o contrato entra completo no dia 1 e o transporte pode esperar.

## Revisitar quando

Quando a taxa de resumed:false passar de ~5% das reconexões (buffer pequeno), quando a segunda réplica entrar em pauta (o buffer precisa sair da memória ou a sequência virar global), ou quando aparecer caso real de bidirecional quente — controle de desktop ao vivo em E11 abre um WebSocket dedicado SÓ para esse canal, sem tocar no stream de domínio.

