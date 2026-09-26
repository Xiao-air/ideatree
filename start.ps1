$ErrorActionPreference = 'Stop'
$ideaRoot = $PSScriptRoot
$ideaUrl = 'http://127.0.0.1:4317'
try {
    $ideaHealth = Invoke-RestMethod -Uri ($ideaUrl + '/api/health') -TimeoutSec 2
    if ($ideaHealth.app -eq 'ideatree') { Start-Process $ideaUrl; exit 0 }
} catch { }
$ideaNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $ideaNode) { throw 'Node.js 20 or newer is required. Install Node.js and run this launcher again.' }
New-Item -ItemType Directory -Path (Join-Path $ideaRoot 'data') -Force | Out-Null
$ideaProcess = Start-Process -FilePath $ideaNode.Source -ArgumentList 'server.mjs' -WorkingDirectory $ideaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $ideaRoot 'data\server.log') -RedirectStandardError (Join-Path $ideaRoot 'data\server-error.log')
for ($ideaAttempt=0; $ideaAttempt -lt 30; $ideaAttempt++) {
    Start-Sleep -Milliseconds 300
    try { $ideaHealth=Invoke-RestMethod -Uri ($ideaUrl+'/api/health') -TimeoutSec 1; if($ideaHealth.app -eq 'ideatree'){Set-Content -LiteralPath (Join-Path $ideaRoot 'data\server.pid') -Value $ideaProcess.Id; Start-Process $ideaUrl;exit 0} } catch { }
    if($ideaProcess.HasExited){break}
}
throw ('IdeaTree failed to start. Check ' + (Join-Path $ideaRoot 'data\server-error.log'))
