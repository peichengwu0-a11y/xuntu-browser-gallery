$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $taskNode) {
    $taskNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $taskNode)) { throw '请安装 Node.js，再运行 node serve.cjs。' }
$taskRunning = $false
try {
    $taskResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:8792/' -TimeoutSec 2
    $taskRunning = $taskResponse.Content.Contains('tuji-browser-pages')
} catch { }
if (-not $taskRunning) {
    $taskServer = Start-Process -FilePath $taskNode -ArgumentList ('"' + (Join-Path $PSScriptRoot 'serve.cjs') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $taskResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:8792/' -TimeoutSec 2
            if ($taskResponse.Content.Contains('tuji-browser-pages')) { $taskRunning = $true; break }
        } catch { }
        if ($taskServer.HasExited) { break }
    }
}
if ($taskRunning) { Start-Process 'http://127.0.0.1:8792/' } else { throw '图迹启动失败，请检查 8792 端口是否被占用。' }

