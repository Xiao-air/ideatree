$ErrorActionPreference = 'Stop'
$ideaRoot = $PSScriptRoot
$ideaLauncher = Join-Path $ideaRoot 'start.ps1'
$ideaIcon = Join-Path $ideaRoot 'public\assets\ideatree.ico'
if (-not (Test-Path -LiteralPath $ideaLauncher) -or -not (Test-Path -LiteralPath $ideaIcon)) {
    throw 'Please extract the complete IdeaTree ZIP before creating the shortcut.'
}
$ideaDesktop = [Environment]::GetFolderPath('Desktop')
$ideaShell = New-Object -ComObject WScript.Shell
$ideaShortcut = $ideaShell.CreateShortcut((Join-Path $ideaDesktop 'IdeaTree.lnk'))
$ideaShortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ideaShortcut.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $ideaLauncher + '"'
$ideaShortcut.WorkingDirectory = $ideaRoot
$ideaShortcut.IconLocation = $ideaIcon + ',0'
$ideaShortcut.Description = 'IdeaTree - Research idea timeline'
$ideaShortcut.WindowStyle = 7
$ideaShortcut.Save()
Write-Host 'IdeaTree shortcut created on your desktop. Keep this folder in place.'
