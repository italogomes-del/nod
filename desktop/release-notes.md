# nod 1.0.0-rc.4

Quarta candidata da 1.0.0, a primeira com o **app desktop do Windows** (ADA-229, ADR-152) ao lado do app do Mac. Macs: DMGs assinados (Developer ID) e notarizados; quem está na rc.3 recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471). Instalação, requisitos e atualização: [guia do desktop](https://github.com/gamefik/nod/blob/v1.0.0-rc.4/docs/release-desktop.md).

## O que entra nesta versão (desde a rc.3, 5/11)

**App desktop do Windows** (#678, ADR-152): mesma base Electron do Mac. O instalador prepara o computador (Git, Node, IAs e o motor do nod numa tarefa agendada, ADR-151) e abre a conversa numa janela. O motor segue rodando com a janela fechada.

- **Primeira abertura sem conta** (#680): o app cria o espaço provisório, como o Mac, e abre direto; a conta é criada de dentro. Quem já tem conta em outro aparelho usa Conectar e confirma o código no navegador.
- **Link de pareamento nunca cai num espaço provisório** (#679): com um código de máquina pendente a aba vai à tela de entrar e, depois do login, Máquinas › Conectar abre com o código.
- **Onboarding fala do computador certo** (#680): "neste computador" e "No PowerShell deste computador, rode `claude auth login`" no Windows; o Mac segue igual.
- Atualização automática própria do Windows: feed `/api/maquina/atualizacao?plataforma=windows`, download com sha256 e instalação silenciosa.

**Esteira da release** (#671, #672, #675, #676): o verify confere a CI verde do commit em vez de repetir os testes; o smoke da janela roda em todo PR que toca o desktop; os discos da VM vêm do cache quando os insumos não mudaram; compressão mais rápida. Release típica: ~15 min.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.4 / v1.0.0-rc.4 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.4-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.4/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.4-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac ok nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente (jornada do site ao uso, 5/11)
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.3)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução; a ligação de voz do onboarding não roda na janela do app (microfone negado): use "Configurar sem voz". Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: o primeiro teste do Windows (5/11) achou que pessoa nova não tinha caminho (#679, #680). Falta: entrar numa conta existente de dentro do provisório na janela do Windows (troca da chave da máquina, como a ponte do Mac faz); assinatura do .exe (NOD-471).
```

Aceite Intel/ARM/Windows: pendente.
