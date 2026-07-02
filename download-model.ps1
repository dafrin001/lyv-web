Write-Host "=== DESCARGANDO MODELO Llama-3.2-1B-Instruct-q4f16 ===" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "https://huggingface.co/onnx-community/Llama-3.2-1B-Instruct-q4f16/resolve/main"
$modelDir = Join-Path $PSScriptRoot "models\Llama-3.2-1B-Instruct-q4f16"
$onnxDir = Join-Path $modelDir "onnx"

# Create directories
foreach ($dir in @($modelDir, $onnxDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

# Files to download
$files = @(
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "generation_config.json"
)

Write-Host "Paso 1: Descargando archivos de configuracion..." -ForegroundColor Yellow
foreach ($file in $files) {
    $dest = Join-Path $modelDir $file
    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) {
        Write-Host "  [SKIP] $file ya existe" -ForegroundColor Gray
        continue
    }
    $url = "$baseUrl/$file"
    Write-Host "  Descargando $file..." -NoNewline
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -ErrorAction Stop
        $size = (Get-Item $dest).Length
        Write-Host " OK ($size bytes)" -ForegroundColor Green
    } catch {
        Write-Host " ERROR: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Paso 2: Descargando modelo ONNX (~1.24 GB)..." -ForegroundColor Yellow
$onnxFile = Join-Path $onnxDir "model_q4f16.onnx"
$url = "$baseUrl/onnx/model_q4f16.onnx"

if (Test-Path $onnxFile) {
    $size = (Get-Item $onnxFile).Length
    Write-Host "  Archivo existente: $([math]::Round($size / 1MB, 1)) MB"
    if ($size -gt 1300000000) {
        Write-Host "  Completo. Saltando descarga." -ForegroundColor Green
        goto :verify
    }
    Write-Host "  Incompleto. Descargando de nuevo..." -ForegroundColor Yellow
}

Write-Host "  Iniciando descarga (puede tomar varios minutos)..." -ForegroundColor Cyan
try {
    $progressPreference = 'silentlyContinue'
    Invoke-WebRequest -Uri $url -OutFile $onnxFile -UseBasicParsing -TimeoutSec 7200 -ErrorAction Stop
    $progressPreference = 'continue'
    $size = (Get-Item $onnxFile).Length
    Write-Host "  DESCARGA COMPLETA: $([math]::Round($size / 1MB, 1)) MB" -ForegroundColor Green
} catch {
    $progressPreference = 'continue'
    Write-Host "  ERROR en descarga: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Descarga manual alternativa:" -ForegroundColor Yellow
    Write-Host "  1. Abre: $url"
    Write-Host "  2. Guarda en: $onnxFile"
}

:verify
Write-Host ""
Write-Host "Paso 3: Verificando integridad..." -ForegroundColor Yellow
$requiredFiles = @(
    (Join-Path $modelDir "config.json"),
    (Join-Path $modelDir "tokenizer.json"),
    (Join-Path $modelDir "tokenizer_config.json"),
    (Join-Path $onnxDir "model_q4f16.onnx")
)
$allOk = $true
foreach ($f in $requiredFiles) {
    if ((Test-Path $f) -and ((Get-Item $f).Length -gt 0)) {
        $size = (Get-Item $f).Length
        Write-Host "  OK: $((Get-Item $f).Name) ($([math]::Round($size / 1MB, 1)) MB)" -ForegroundColor Green
    } else {
        Write-Host "  FALTA: $f" -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ""
if ($allOk) {
    Write-Host "MODELO LISTO PARA USAR!" -ForegroundColor Green
} else {
    Write-Host "FALTAN ARCHIVOS. Revisa los errores arriba." -ForegroundColor Red
}
