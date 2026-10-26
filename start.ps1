$ErrorActionPreference = 'Stop'
$ideaRoot = $PSScriptRoot
$ideaUrl = 'http://127.0.0.1:4317'
$ideaBrowser = $null
foreach ($ideaBrowserPath in @('Microsoft\Edge\Application\msedge.exe', 'Google\Chrome\Application\chrome.exe')) {
    foreach ($ideaInstallRoot in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
        if (-not $ideaInstallRoot) { continue }
        $ideaCandidate = Join-Path $ideaInstallRoot $ideaBrowserPath
        if (Test-Path -LiteralPath $ideaCandidate -PathType Leaf) { $ideaBrowser = $ideaCandidate; break }
    }
    if ($ideaBrowser) { break }
}
if (-not $ideaBrowser) { throw 'IdeaTree needs Microsoft Edge or Google Chrome for its standalone window. Install either browser and try again.' }
function Open-IdeaTreeWindow {
    $ideaWindowProfile = Join-Path $ideaRoot 'data\window-profile'
    Start-Process -FilePath $ideaBrowser -ArgumentList @(
        "--app=$ideaUrl",
        ('--user-data-dir="' + $ideaWindowProfile + '"'),
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--start-maximized'
    ) -WindowStyle Normal
}
try {
    $ideaHealth = Invoke-RestMethod -Uri ($ideaUrl + '/api/health') -TimeoutSec 2
    if ($ideaHealth.app -eq 'ideatree') { Open-IdeaTreeWindow; exit 0 }
} catch { }
$ideaNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $ideaNode) { throw 'Node.js 20 or newer is required. Install Node.js and run this launcher again.' }
New-Item -ItemType Directory -Path (Join-Path $ideaRoot 'data') -Force | Out-Null
$ideaProcess = Start-Process -FilePath $ideaNode.Source -ArgumentList 'server.mjs' -WorkingDirectory $ideaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $ideaRoot 'data\server.log') -RedirectStandardError (Join-Path $ideaRoot 'data\server-error.log')
for ($ideaAttempt=0; $ideaAttempt -lt 30; $ideaAttempt++) {
    Start-Sleep -Milliseconds 300
    try { $ideaHealth=Invoke-RestMethod -Uri ($ideaUrl+'/api/health') -TimeoutSec 1; if($ideaHealth.app -eq 'ideatree'){Set-Content -LiteralPath (Join-Path $ideaRoot 'data\server.pid') -Value $ideaProcess.Id; Open-IdeaTreeWindow;exit 0} } catch { }
    if($ideaProcess.HasExited){break}
}
throw ('IdeaTree failed to start. Check ' + (Join-Path $ideaRoot 'data\server-error.log'))
