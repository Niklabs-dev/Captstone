param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$frontendPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$applicationPath = [System.IO.Path]::GetFullPath((Join-Path $frontendPath '..'))
$storeId = '10000000-0000-4000-8000-000000000010'
$env:USER_MANAGEMENT_STORES = '[{"id":"10000000-0000-4000-8000-000000000010","name":"Local de prueba"}]'
$env:TEST_USERS_STORE_ID = $storeId
$env:TEST_USERS_FRONTEND_URL = 'http://localhost:3102'
$env:TEST_USERS_BACKEND_URL = 'http://localhost:3103'
$env:TEST_USERS_DISPOSABLE = 'true'
if (-not $env:TEST_USERS_ADMIN_EMAIL -or -not $env:TEST_USERS_ADMIN_PASSWORD) {
    throw 'Define TEST_USERS_ADMIN_EMAIL y TEST_USERS_ADMIN_PASSWORD con las credenciales del seed de este entorno.'
}
Push-Location $applicationPath
try {
    $composeArgs = @('compose', '-p', 'capstone-sprint1-t10', '-f', 'docker-compose.yml', '-f', 'frontend/docs/docker-compose.users-test.yml')
    if ($SkipBuild) { & docker @composeArgs up -d } else { & docker @composeArgs up --build -d }
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo levantar Docker.' }
    $sql = "INSERT INTO stores (id, name, city, address, is_active, updated_at) VALUES ('$storeId', 'Local de prueba', 'Prueba', 'Direccion ficticia', true, now()) ON CONFLICT (id) DO NOTHING;"
    $sql | & docker @composeArgs exec -T db psql -U postgres -d subway_gestion -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar el local ficticio.' }
    $deadline = (Get-Date).AddSeconds(60)
    do {
        try { $health = Invoke-WebRequest -Uri "$env:TEST_USERS_BACKEND_URL/" -UseBasicParsing -TimeoutSec 2; if ($health.StatusCode -eq 200) { break } } catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not $health -or $health.StatusCode -ne 200) { throw 'El backend no esta disponible.' }
} finally { Pop-Location }
Push-Location $frontendPath
try {
    & npm run test:users:e2e
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas de navegador.' }
} finally { Pop-Location }
