# ADA-226: o que o desinstalador do Nod roda antes de apagar %LOCALAPPDATA%\nod.
# Para o motor, tira a Tarefa Agendada e a chave Run (nod-motor-<SID>, ADR-151) e as pastas do Nod no Path do usuario.
# Fica: a conexao (%APPDATA%\nod-motor, para reinstalar sem parear de novo), o Git, o Claude Code e o %APPDATA%\npm.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::Default } catch { $null = $_ }

$pasta = Join-Path $env:LOCALAPPDATA 'nod'
$nome = 'nod-motor-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

$tarefa = Get-ScheduledTask -TaskName $nome -TaskPath '\' -ErrorAction SilentlyContinue
if ($null -ne $tarefa) {
  Stop-ScheduledTask -TaskName $nome -TaskPath '\' -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $nome -TaskPath '\' -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output 'Tarefa do motor removida.'
}
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $nome -ErrorAction SilentlyContinue

# O motor e o Node portatil do Nod: so os processos cujo executavel mora na pasta do Nod.
$prefixo = $pasta.TrimEnd('\') + '\'
$processos = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefixo, [StringComparison]::OrdinalIgnoreCase) })
# Com a arvore: os filhos do motor (claude, codex, shells dos turnos) seguram arquivos da pasta e sobreviveriam ao pai.
$todos = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue)
$arvore = [System.Collections.Generic.List[int]]::new()
$fila = [System.Collections.Generic.Queue[int]]::new()
foreach ($p in $processos) { $fila.Enqueue([int]$p.ProcessId) }
while ($fila.Count -gt 0) {
  $id = $fila.Dequeue()
  if ($arvore.Contains($id)) { continue }
  $arvore.Add($id)
  foreach ($f in $todos) { if ($f.ParentProcessId -eq $id -and $f.ProcessId -ne $id) { $fila.Enqueue([int]$f.ProcessId) } }
}
# Dos filhos para o pai: o pai morto antes nao recria o filho.
for ($i = $arvore.Count - 1; $i -ge 0; $i--) { Stop-Process -Id $arvore[$i] -Force -ErrorAction SilentlyContinue }
foreach ($id in $arvore) { Wait-Process -Id $id -Timeout 15 -ErrorAction SilentlyContinue }
if ($processos.Count -gt 0) { Write-Output 'Motor parado.' }

# O Path do usuario sem as pastas do Nod, mantendo o tipo ExpandString (como a ADA-32 grava).
$tirar = @((Join-Path $pasta 'bin'), (Join-Path $pasta 'node'))
$chave = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($null -ne $chave) {
  try {
    $atual = [string]$chave.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $itens = @($atual -split ';' | Where-Object { $_ -ne '' })
    $ficam = @($itens | Where-Object { $item = [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\'); -not ($tirar | Where-Object { $_ -ieq $item }) })
    if ($ficam.Count -ne $itens.Count) {
      $chave.SetValue('Path', ($ficam -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
      Write-Output 'Path do usuário limpo.'
    }
  } finally { $chave.Close() }
}
# Apagar pelo .NET avisa o Windows (WM_SETTINGCHANGE): o terminal novo ja ve o Path novo.
[Environment]::SetEnvironmentVariable('NOD_INSTALADO_EM', $null, 'User')
Write-Output 'Nod removido deste Windows. A conexão fica guardada para quando instalar de novo.'
exit 0
