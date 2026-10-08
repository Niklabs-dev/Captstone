param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$frontendPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$applicationPath = [IO.Path]::GetFullPath((Join-Path $frontendPath '..'))
if (-not $env:TEST_AUDIT_ADMIN_EMAIL -or -not $env:TEST_AUDIT_ADMIN_PASSWORD) {
    throw 'Define TEST_AUDIT_ADMIN_EMAIL y TEST_AUDIT_ADMIN_PASSWORD con las credenciales del seed del entorno de prueba.'
}
$env:TEST_AUDIT_STORE_ID = '10000000-0000-4000-8000-000000000016'
$env:TEST_AUDIT_OTHER_STORE_ID = '20000000-0000-4000-8000-000000000016'
$env:TEST_AUDIT_FRONTEND_URL = 'http://localhost:3106'
$env:TEST_AUDIT_BACKEND_URL = 'http://localhost:3107'
$env:TEST_AUDIT_DISPOSABLE = 'true'
$env:AUDIT_STORES = '[{"id":"10000000-0000-4000-8000-000000000016","name":"Local de prueba T16"},{"id":"20000000-0000-4000-8000-000000000016","name":"Otro local de prueba T16"}]'
Push-Location $applicationPath
try {
    $composeArgs = @('compose', '-p', 'capstone-sprint1-t16', '-f', 'docker-compose.yml', '-f', 'frontend/docs/docker-compose.audit-test.yml')
    if ($SkipBuild) { & docker @composeArgs up -d } else { & docker @composeArgs up --build -d }
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo levantar Docker.' }
    $deadline = (Get-Date).AddSeconds(60)
    $health = $null
    do {
        try { $health = Invoke-WebRequest -Uri "$env:TEST_AUDIT_BACKEND_URL/" -UseBasicParsing -TimeoutSec 2; if ($health.StatusCode -eq 200) { break } } catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not $health -or $health.StatusCode -ne 200) { throw 'El backend no esta disponible.' }
    Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'audit-fixtures.sql') | & docker @composeArgs exec -T db psql -U postgres -d subway_gestion -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar las fixtures ficticias de auditoria.' }
} finally { Pop-Location }
Push-Location $frontendPath
try {
    & npm run test:audit:e2e
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas de auditoria.' }
} finally { Pop-Location }
