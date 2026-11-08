# nod 1.0.0-rc.6

Sexta candidata da 1.0.0: as partes nativas do **onboarding novo** (jornadas A, B e D) no app do Mac e do Windows, e o **desinstalador de verdade no Windows**. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471). Instalação, requisitos e atualização: [guia do desktop](https://github.com/gamefik/nod/blob/v1.0.0-rc.6/docs/release-desktop.md).

## O que entra nesta versão (desde a rc.5, 5/11)

- **Entrar com o Google dentro do app** (jornada A, #691, ADR-157): o loopback do OAuth roda no processo principal do Electron, no Mac e no Windows; o segredo de troca nunca sai dele e a conta só se liga depois da prova.
- **Ponte "este computador"** (jornadas A e B, #691 e #692): `nodDesktop.estaMaquina()` e o "já vi" por máquina (`este-computador.json` na pasta do app), para a tela "Este computador" e "Oi de novo · este computador" mostrarem o estado real da IA desta máquina.
- **Remover o nod deste computador** (jornada D, #694): ponte `removerDaqui` no app; no Windows, `scripts/windows/desinstalar.ps1` vira o desinstalador único (com `-ManterConexao` e `-ManterIas`), o `.exe` aceita `/MANTERIAS` e `/MANTERCONEXAO`, o desinstalador do app chama `nod-motor desinstalar` e o Claude só sai se foi o nod que instalou (marca `ias-do-nod.json`). O desinstalador entra sem flag, porque é correção.
- **Janela do Windows não abre mais em branco** (`aoAbrir is not a function`, #689).
- Release: retry no grampo da notarização quando o CloudKit da Apple cai (#685).
- As telas novas do onboarding (conta sem senha, conversa por texto, "Onde os bots trabalham", remover computador) ficam atrás de `NOD_ONBOARDING_TEXTO=1` no servidor, ainda desligada: com ela desligada, o app se comporta como na rc.5.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.6 / v1.0.0-rc.6 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.6-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.6/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.6-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac ok nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente (instalar, onboarding e remover pelo desinstalador)
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.5)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução; a ligação de voz do onboarding não roda na janela do app (microfone negado): use "Configurar sem voz"; se o navegador não abrir ao clicar em Entrar, rode o comando no PowerShell (o cartão mostra qual). Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: o desinstalador da rc.5 deixava o motor e as IAs para trás no Windows (corrigido). Falta: ligar NOD_ONBOARDING_TEXTO depois do aceite das jornadas A, B e D, login dentro do app com link e código na tela (como o Mac faz desde 10/10), entrar numa conta existente de dentro do provisório na janela do Windows, assinatura do .exe (NOD-471).
```

Aceite Intel/ARM/Windows: pendente.
