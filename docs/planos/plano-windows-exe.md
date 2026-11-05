# Plano: o instalador `.exe` do Nod no Windows

Definido em 2026-11-05 (urgente: a contadora instala hoje, só clicando). Estende a
[ADR-151](../adr/adr-151-instalador-do-motor-no-windows.md) (o `irm … | iex` da ADA-32, PR #658).

## Decisão de escopo

O app desktop (Electron) **não** roda no Windows hoje: o plano da Fase 1 (`plano-windows-fase1.md`, tabela de riscos)
marca o desktop como bloqueante (tabela de IAs sem win32, wrapper `#!/bin/sh`, symlinks, deep link só no plist, NSIS
nunca testado) e o deixa para a Fase 3. O que funciona e é testado no Windows é o motor com o instalador da ADA-32.
Então o `.exe` é um **instalador NSIS por usuário** (sem admin) que faz exatamente o que o `irm … | iex` faz, sem a
pessoa abrir terminal:

1. baixa o script do servidor (`<servidor>/windows`, o mesmo da ADA-32: endereço e versão embutidos pelo servidor) e o
   roda num PowerShell escondido, com a saída na janela do instalador (`nsExec::ExecToLog`);
2. o script instala Git, Node, Claude Code, o motor e a Tarefa Agendada, e o pareamento abre o navegador no link com o
   código (o código também aparece na janela do instalador);
3. cria os atalhos **Nod** (Menu Iniciar e Área de Trabalho, para `https://app.nodbot.ai`) e o desinstalador em
   **Configurações › Aplicativos**; a página final tem **Abrir o Nod** marcado.

O Electron no Windows segue na Fase 3. Suposição registrada: "abrir o Nod" = o Nod web no navegador, com o motor
conectado nesta máquina.

## Módulos

- `scripts/windows/instalador.nsi` — o instalador (MUI2, `RequestExecutionLevel user`, PowerShell de 64 bits pelo
  `Sysnative`). Nome fixo `nod-windows-x64.exe`.
- `scripts/windows/instalar-pelo-exe.ps1` — o que o `.exe` roda: valida o servidor (HTTPS ou loopback), `irm
  <servidor>/windows | iex`, sai com 0 só se `NOD_INSTALACAO_RESULTADO=ok`. O servidor chega por variável de ambiente,
  nunca interpolado na linha de comando. `/SERVIDOR=` só para a CI e o suporte.
- `scripts/windows/desinstalar-pelo-exe.ps1` — para o motor, tira a Tarefa Agendada e a chave Run, limpa o `Path` do
  usuário. Não toca a conexão (`%APPDATA%\nod-motor`) nem o Git.
- `scripts/windows/gerar-exe.mjs` — monta o `.ico` a partir do `icon.png` e chama o `makensis`.
- `src/adapters/http/servidor.ts` — `GET /download/windows` → 302 para o `.exe` no bucket público `nodbot-downloads`
  (o mesmo dos DMGs; o repositório é privado, então o asset da release do GitHub não é público). Nome fixo, sem API.
- CI (`ci.yml`, job `windows`): monta o `.exe`, instala com `/S` contra o servidor de teste até o pareamento, confere a
  instalação, os atalhos e o desinstalador, abre o atalho e sobe os prints e o `.exe` como artifact.
- Release (`desktop-release.yml`): job `windows` que monta, testa e publica `nod-windows-x64.exe` + `.sha256` na release.
- Site: botão **Baixar para Windows** e `/download/windows` no `_redirects` (PR separado, deploy manual do Marlon).

## Dados e migrações

Nenhum.

## Ações

Ações: nenhuma ação nova.

## Bordas e erros

- Falha no script: o `.exe` mostra a mensagem do script na janela, avisa onde está o log (`%LOCALAPPDATA%\nod\
  instalador.log`) e sai com código ≠ 0 (no `/S` também).
- Sem rede/servidor fora: mensagem clara, nada instalado pela metade (o script é tudo ou nada).
- Pareamento: espera a confirmação no navegador (prazo do servidor); expirou, o instalador falha e pede para rodar de novo.
- Rodar de novo = atualizar (o script já trata).
- SmartScreen: sem certificado, o `.exe` sai sem assinatura. Aviso documentado ("Mais informações › Executar assim mesmo").

## Testes

- Unitário: a rota `/download/windows` (302, `cache-control`, só GET), o `.nsi` (por usuário, sem admin, PowerShell por
  caminho absoluto, servidor pelo ambiente) e o `.ps1` (validação do servidor).
- Windows de verdade na CI: instalação silenciosa, `conferir-instalacao.ps1`, atalhos, entrada do desinstalador,
  desinstalação, e prints.

## Riscos

- SmartScreen/Defender sem assinatura (pendência humana: certificado de código).
- Saída do PowerShell com acentos no log do NSIS (página de código): forçada para a ANSI do Windows.
- `nsExec` não termina se algum filho herdar o pipe: o motor sobe por `Start-ScheduledTask`/`Start-Process` (sem herança).

## Commits

1. `desktop: plano do instalador .exe do Windows`
2. `desktop: instalador NSIS que roda o instalador da ADA-32 sem terminal`
3. `servidor: /download/windows redireciona para o .exe`
4. `ci: monta, instala e fotografa o .exe no windows-latest`
5. `release: o .exe e o .sha256 na release do desktop`
6. `docs: instruções para quem instala no Windows`
