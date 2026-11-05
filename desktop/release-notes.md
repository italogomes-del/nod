# nod 1.0.0-rc.5

Quinta candidata da 1.0.0: a correção do **login das IAs no app do Windows**, achada no segundo teste real de 5/11. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471). Instalação, requisitos e atualização: [guia do desktop](https://github.com/gamefik/nod/blob/v1.0.0-rc.5/docs/release-desktop.md).

## O que entra nesta versão (desde a rc.4, 5/11)

- **"Entrar" nas IAs funciona na janela do Windows** (ADR-152, item 10): a janela ganhou a ponte mínima `nodDesktop` (`iaEntrar`/`iaInstalar`). O clique abre o login do próprio CLI (`claude auth login` / `codex login`), que abre o navegador; o motor percebe o login em segundos e a tela segue. Antes a janela não tinha ponte e a pessoa era mandada ao PowerShell. Sem a IA instalada, o cartão abre a página oficial.
- O `.cmd` do npm roda como `node <script>` com o Node do motor (ADR-147), sem `cmd.exe`; um `claude.exe` no Path ganha do `.cmd`.
- A tela "Provedores de IA" e os avisos da ligação sem IA dizem "neste computador" / "PowerShell" no Windows.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.5 / v1.0.0-rc.5 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.5-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.5/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.5-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac ok nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente (jornada do site ao uso, 5/11)
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.4)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução; a ligação de voz do onboarding não roda na janela do app (microfone negado): use "Configurar sem voz"; se o navegador não abrir ao clicar em Entrar, rode o comando no PowerShell (o cartão mostra qual). Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: a rc.4 mandava a pessoa ao PowerShell no passo das IAs (sem ponte na janela). Falta: login dentro do app com link e código na tela (como o Mac faz desde 10/10), entrar numa conta existente de dentro do provisório na janela do Windows, assinatura do .exe (NOD-471).
```

Aceite Intel/ARM/Windows: pendente.
