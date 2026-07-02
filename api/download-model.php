<?php
declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');

if (php_sapi_name() !== 'cli') {
    // Web mode - show instructions
    echo "=== DESCARGADOR DE MODELO ONNX ===\n\n";
    echo "Este script debe ejecutarse por línea de comandos:\n";
    echo "  php api/download-model.php\n\n";
    echo "O desde PowerShell:\n";
    echo "  & php api/download-model.php\n\n";
    exit;
}

echo "=== DESCARGANDO MODELO Llama-3.2-1B-Instruct-q4f16 ===\n\n";

$baseUrl = 'https://huggingface.co/onnx-community/Llama-3.2-1B-Instruct-q4f16/resolve/main';
$modelDir = __DIR__ . '/../models/Llama-3.2-1B-Instruct-q4f16';
$onnxDir = $modelDir . '/onnx';

// Ensure directories exist
foreach ([$modelDir, $onnxDir] as $dir) {
    if (!is_dir($dir)) mkdir($dir, 0755, true);
}

// Files to download (excluding large ONNX which is downloaded separately)
$files = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
    'generation_config.json',
];

echo "Paso 1: Descargando archivos de configuración...\n";
foreach ($files as $file) {
    $dest = $modelDir . '/' . $file;
    if (file_exists($dest) && filesize($dest) > 0) {
        echo "  [SKIP] $file ya existe\n";
        continue;
    }
    $url = $baseUrl . '/' . $file;
    echo "  Descargando $file... ";
    $content = @file_get_contents($url);
    if ($content === false) {
        echo "ERROR\n";
        continue;
    }
    file_put_contents($dest, $content);
    echo "OK (" . strlen($content) . " bytes)\n";
}

echo "\nPaso 2: Descargando modelo ONNX (1.24 GB)...\n";
echo "  URL: $baseUrl/onnx/model_q4f16.onnx\n";
echo "  Destino: $onnxDir/model_q4f16.onnx\n\n";

$onnxFile = $onnxDir . '/model_q4f16.onnx';
if (file_exists($onnxFile) && filesize($onnxFile) > 1000000) {
    $size = filesize($onnxFile);
    echo "  El archivo ya existe: " . round($size / 1024 / 1024, 1) . " MB\n";
    if ($size > 1300000000) {
        echo "  Completo. No es necesario descargar.\n";
        exit(0);
    }
    echo "  Parece incompleto. Se descargará de nuevo.\n";
}

echo "Iniciando descarga (puede tomar varios minutos)...\n\n";

$url = $baseUrl . '/onnx/model_q4f16.onnx';
$fp = fopen($onnxFile, 'w+');
if (!$fp) {
    echo "ERROR: No se puede abrir archivo de destino\n";
    exit(1);
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_FILE => $fp,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 7200, // 2 hours max
    CURLOPT_BUFFERSIZE => 8192 * 1024, // 8MB buffer
    CURLOPT_NOPROGRESS => false,
    CURLOPT_PROGRESSFUNCTION => function($resource, $downloadSize, $downloaded, $uploadSize, $uploaded) {
        if ($downloadSize > 0) {
            $pct = round($downloaded / $downloadSize * 100, 1);
            $downloadedMb = round($downloaded / 1024 / 1024, 1);
            $totalMb = round($downloadSize / 1024 / 1024, 1);
            echo "\r  Progreso: $pct% ($downloadedMb MB / $totalMb MB)";
        }
    },
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; LyV-Downloader/1.0)',
]);

$result = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);
fclose($fp);

echo "\n";

if ($result && $httpCode === 200) {
    $size = filesize($onnxFile);
    echo "\nDESCARGA COMPLETA!\n";
    echo "Tamaño: " . round($size / 1024 / 1024, 1) . " MB\n";
    echo "Archivo: $onnxFile\n";
} else {
    echo "\nERROR en descarga: HTTP $httpCode";
    if ($error) echo " - $error";
    echo "\n\n";
    echo "Intenta descargar manualmente:\n";
    echo "1. Abre: $url\n";
    echo "2. Guarda el archivo en: $onnxFile\n";
}

echo "\nPaso 3: Verificando integridad...\n";
$requiredFiles = [
    $modelDir . '/config.json',
    $modelDir . '/tokenizer.json',
    $modelDir . '/tokenizer_config.json',
    $onnxDir . '/model_q4f16.onnx',
];
$allOk = true;
foreach ($requiredFiles as $f) {
    if (!file_exists($f) || filesize($f) === 0) {
        echo "  FALTA: $f\n";
        $allOk = false;
    } else {
        $size = filesize($f);
        echo "  OK: " . basename(dirname(dirname($f))) . '/' . basename(dirname($f)) . '/' . basename($f) . " (" . round($size / 1024 / 1024, 1) . " MB)\n";
    }
}

if ($allOk) {
    echo "\n✓ MODELO LISTO PARA USAR\n";
} else {
    echo "\n× FALTAN ARCHIVOS. Revisa los errores arriba.\n";
}
