# ADR-151 — O instalador do motor no Windows

Status: proposta (2026-11-04, ADA-32) · Emenda a [ADR-147](adr-147-motor-no-windows-nativo.md) (a limitação "sem
instalador, serviço, atualização" vira "sem atualização automática") e estende a
[ADR-090](adr-090-o-motor-numa-maquina-linux-da-pessoa.md) (o script gerado pelo servidor) ao Windows. Plano em
[docs/planos/plano-windows-instalador.md](../planos/plano-windows-instalador.md).

## Contexto

Desde a ADR-147 o motor roda no Windows 10 22H2/11 x64, mas só à mão: instalar Node e Git, baixar três arquivos, parear
e deixar um terminal aberto. Nada volta depois de reiniciar. No Linux é um comando (`curl -fsSL <nod>/motor | sh`).

## Decisão

1. **Um comando, gerado pelo servidor.** `irm https://nodbot.ai/windows | iex`. O site redireciona (302) para
   `https://app.nodbot.ai/windows`, que redireciona para `GET /api/motor/instalar-windows[?convite=]`: um PowerShell com
   o endereço e a versão do servidor embutidos, como o script do Linux. "Versão estável" é a que o servidor oficial
   roda; publicar motor novo é fazer o deploy do servidor.
2. **Node portátil e fixo** (`NODE_DO_MOTOR`, o mesmo do Linux) em `%LOCALAPPDATA%\nod\node`, baixado do nodejs.org com
   o sha256 do `SHASUMS256.txt` conferido. Não pelo winget: o MSI do Node é de máquina (UAC), sem versão fixa, e mexe no
   Node da pessoa.
3. **Git for Windows por winget no escopo do usuário** (`--scope user`), depois sem escopo (UAC avisado), e sem winget
   o instalador oficial com a assinatura Authenticode conferida (`/CURRENTUSER`).
4. **Claude Code e Codex pelo npm do Node do nod**, no piso de `flag-floors.ts`, só quando faltam ou estão abaixo dele.
   Sem nenhum dos dois no fim, erro claro.
5. **O motor em `%LOCALAPPDATA%\nod\motor\app`**, com sha256 conferido contra `/api/motor/manifesto` e troca por
   `app.novo` → `app` (`app.anterior` guardado). A conexão continua em `%APPDATA%\nod-motor` (ADR-147) e nunca é tocada.
6. **`nod.cmd` e `nod-motor.cmd`** em `%LOCALAPPDATA%\nod\bin`, no `Path` do usuário. `.cmd`, não `.ps1`: roda com
   qualquer ExecutionPolicy. Chamam o Node e o motor por caminho absoluto.
7. **Sobe no login por Tarefa Agendada do usuário, sem admin**: AtLogOn do próprio usuário, Interactive, Limited, sem
   limite de duração, reinício em falha a cada minuto, `conhost.exe --headless` para não abrir janela. Se a política
   recusar a tarefa, a chave `HKCU\…\Run` (sem reinício em falha, avisado). A tarefa fica na raiz do Agendador, que é
   da máquina: o nome é `\nod-motor-<SID>`, uma por conta do Windows (com um nome só, a segunda conta sobrescreveria
   ou adotaria a tarefa da primeira).
8. **Rodar de novo = atualizar**: para a tarefa, espera o `node.exe` do nosso `app` sair (30 s, depois `taskkill /F` só
   nesses pids), troca o que mudou e sobe de novo. Com `conexao.json`, pula o pareamento. A atualização automática do
   motor segue desligada no win32 (ADR-147 item 6); o motor manda rodar o `irm … | iex` quando o servidor pede versão nova.
9. **O script nunca chama `exit`** (fecharia o PowerShell de quem colou) e roda inteiro dentro de um `& { … }`: corte no
   meio do download vira erro de parse e nada roda pela metade. O pareamento abre o link no navegador (`parear --abrir`,
   `explorer.exe` por caminho absoluto).

## Alternativas descartadas

- **`.exe`/MSI assinado**: precisa de certificado de código e de uma pessoa; fora do escopo da ADA-32.
- **winget para tudo** (Node incluído): UAC e versão solta (item 2).
- **Serviço do Windows**: pede admin e roda fora da sessão da pessoa, sem o perfil dela (as IAs logam por usuário).
- **Atalho na pasta Inicializar**: sem reinício em falha e abre janela; fica só a chave `Run` como reserva.

## Consequências

- O instalador é testado na CI (`windows-latest`): PSScriptAnalyzer sem achados e execução duas vezes até antes do
  pareamento, contra um servidor de teste em loopback.
- `nodbot.ai/windows` depende do deploy manual do site (ADR-118); até lá vale `irm https://app.nodbot.ai/windows | iex`.
- Win11 limpo, reinício e UAC só se provam no Windows real (ADA-31).

## Gatilho de reversão

Se a ADA-31 ou o suporte mostrarem a Tarefa Agendada recusada, janela aberta ou o Defender bloqueando o `irm | iex` em
mais de 1 de cada 5 máquinas, trocar por instalador assinado ou app desktop com login item (Fase 3 da ADR-147).
