# ADR-138 — A tela do computador do bot é ao vivo (VNC) quando a pessoa está no controle

Status: aceita (2026-10-29, NOD-95) · Emenda a [ADR-037](adr-037-computadores-por-bot.md) ("screenshots periódicos, não
streaming" sai), [ADR-122](adr-122-o-computador-da-pessoa-roda-no-motor.md) (a tela ganha o x11vnc; a mensagem `vivo`
no socket de controle) e [ADR-021](adr-021-ponte-maquina-local.md) (um canal contínuo motor → servidor, ainda sem o
servidor discar).

## Contexto

Com a pessoa no controle, a tela cheia mostrava uma captura (scrot → PNG → base64) a cada 2 s, e cada clique, tecla ou
rolagem virava uma ação: transação com trava, registro, reserva, fila da máquina (long-poll de 250 ms), socket, IPC,
xdotool e uma captura de volta — seis saltos por quadro. A ADR-037 exclui streaming de propósito. No primeiro ensaio
real no Mac (29/10/2026) o Marlon tentou rolar uma página e desistiu: "impossível usar". A referência de produto (Grok
Bot) mostra o desktop inteiro ao vivo, com "Take control", e a pessoa usa como um computador remoto.

## Decisão

1. **No controle, a tela é ao vivo; assistindo, continua nas capturas.** A tela cheia (web/telas/tela-cheia.ts) pede o
   ao vivo quando a pessoa assume e o desliga quando devolve, fecha ou perde o controle por fora. Teclado, mouse e
   rolagem vão pelo VNC, sem passar pelas ações; as ações de antes seguem valendo e são o caminho de volta quando o ao
   vivo não liga ou cai. Assistindo ao vivo, áudio e compartilhar com outra pessoa ficam fora.
2. **O protocolo é o VNC (RFB) do próprio Xvfb da tela**, servido pelo `x11vnc` que a tela sobe no primeiro pedido, só
   num socket unix (`-unixsock /tmp/nod-vnc-<display>.sock`, `-rfbport 0 -rfbportv6 0`, no `/tmp` privado da unit do
   supervisor, fora do bwrap das telas): sem porta TCP, porque outra tela, que vê a rede, enxergaria esta. O cliente é o noVNC (MPL-2.0, THIRD_PARTY_NOTICES.md), carregado só ao assumir. Transmitir só a
   janela do Chrome pelo CDP (como o OpenMausBot) foi descartado: não mostra o desktop com dock, que é o alvo (NOD-96,
   NOD-410).
3. **O canal é um WebSocket de saída do motor.** O servidor não disca (ADR-021): a web abre
   `wss://…/api/t/:t/agentes/:id/computador/vivo` (cookie, tenant do caminho, `Origin` do mesmo host, como a mídia da
   voz); o servidor cria a sessão (id + token de uso único), manda o comando assinado `vivo` à máquina pela fila de
   sempre, e o motor abre `wss://…/api/maquina/computador/vivo/:sessao?t=token` de volta. O servidor pareia os dois e
   só repassa bytes; não interpreta nem guarda quadro nenhum (a regra da ADR-037 sobre não gravar a tela da pessoa
   continua). O token, não a chave da máquina, autentica o motor: o WebSocket global do Node e do Electron não leva
   header próprio, e o token nasce no comando assinado que só a máquina certa recebe.
4. **No socket de controle, `vivo` muda o que a conexão é.** O motor abre uma conexão só para isso e manda
   `{tipo:"vivo", comando}`; aceita, essa conexão vira o fluxo cru do VNC (os estados param de chegar nela); recusada,
   fecha. O supervisor só serve a tela já aberta ou abrindo (5ª revisão: a web a abre pela captura antes; um `vivo` atrasado
   que chega depois do `fechar_tela` do Parar é recusado com `tela_alterada` em vez de reabrir a tela) e, enquanto o fluxo
   corre, toca a tela a cada 30 s: para a régua e para o varredor de ociosidade do servidor, a pessoa ao vivo é ação.
   No Mac (ADR-127) nada muda: é o mesmo `ctl.sock` encaminhado pelo Lima, sem porta nem mount novo.
5. **Só com a pessoa no controle.** O portão (`computadores.vivo`) exige `controle = pessoa`, computador no ar e sem
   operação em curso, como as ações da pessoa; devolver ou parar encerra as sessões ao vivo da tela (`fecharDaTela`).
   O bot já está parado pelo controle; o ao vivo não entra na reserva das ações. Revisão do PR #599: o
   "iniciar" também encerra (assumir não, porque a pessoa segue no controle); cada sessão pareada reconfere o controle, a tela aberta e o computador no ar a cada 10 s (cobre a corrida entre o portão e o
   pareamento); no máximo 2 sessões por pessoa e tela (a mais antiga cai); e o repasse tem contrapressão (o motor pausa
   o VNC com 4 MiB na fila do WebSocket; o servidor derruba o lado que passa de 8 MiB sem ler).
6. **A retomada pelo bot (definido em 2026-10-29 no 1º ensaio, restrito na revisão do PR #599).** Com a pessoa no
   controle, o bot só retoma quando o turno é um pedido NOVO dela: turno da pessoa (`daPessoa`, ADR-131) nascido de mensagem
   dela (origem conversa; a `retomada` automática não conta; hoje os turnos de sala e de ligação não levam a mensagem de
   origem e por isso não retomam, do lado seguro) cuja mensagem de origem foi escrita pela
   própria pessoa dona do computador depois do último "assumir" daquele computador ou tela (3ª revisão: a data é a da
   mensagem, não a do turno, porque a repetição por cota ou troca de IA reenfileira com data nova; e a fala de um bot na
   sala não conta), e sem pedido de ajuda do bot aberto. O Parar também é
   freio (4ª revisão): a mensagem de antes dele não retoma, e o ao vivo não reabre a tela parada até um assumir novo. Retomar devolve o controle ao
   bot, encerra o ao vivo dela e deixa "retomou o computador" na Atividade. Rotina, colega, frente, o turno que já
   corria quando ela assumiu e o pedido de ajuda seguem em `aguardando_pessoa` (ADR-037: o Assumir é o freio dela).

## Consequências

- Rolar, arrastar e digitar ficam como num computador remoto; a captura de 2 s segue para quem assiste e para o bot.
- Um dependência nova de runtime na web (noVNC) e um pacote novo na máquina (`x11vnc`, no `PACOTES_DO_COMPUTADOR`).
  Máquinas instaladas antes não têm o x11vnc: o `vivo` falha com `faltam_pacotes` e a tela cheia fica nas capturas,
  até o instalador rodar de novo (idempotente).
- O servidor passa a ter sessões de WebSocket pareadas em memória; um reinício as derruba e a web volta às capturas.
- O teto de 64 KiB por mensagem do WebSocket vale: o motor parte o fluxo em pedaços de 32 KiB.

## Gatilho de reversão

- Mais de 1 em 5 sessões ao vivo caindo em 14 dias (log `computador_vivo_*`): rever o transporte (parear por WebRTC ou
  trocar o VNC pelo screencast do Chrome).
- O x11vnc passando de 25% de uma CPU com a pessoa parada na tela: trocar por um encoder com detecção de mudança.
