<?php
declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');

echo "Generando colombia-data.js desde api-colombia.com...\n\n";

$deptUrl = 'https://api-colombia.com/api/v1/Department';
$deptJson = @file_get_contents($deptUrl);
if (!$deptJson) {
    die("ERROR: No se pudo obtener departamentos\n");
}

$departments = json_decode($deptJson, true);
if (!$departments) {
    die("ERROR: JSON inválido\n");
}

echo "Departamentos obtenidos: " . count($departments) . "\n\n";

$output = [];
foreach ($departments as $dept) {
    $name = $dept['name'];
    echo "Procesando: $name... ";

    // Obtener ciudades del departamento
    $cityUrl = "https://api-colombia.com/api/v1/Department/{$dept['id']}/cities";
    $cityJson = @file_get_contents($cityUrl);
    $cities = [];

    if ($cityJson) {
        $cityData = json_decode($cityJson, true);
        if ($cityData) {
            foreach ($cityData as $city) {
                $cities[] = $city['name'];
            }
        }
    }

    // Si no se pudieron obtener ciudades, al menos incluir la capital
    if (empty($cities) && isset($dept['cityCapital']['name'])) {
        $cities[] = $dept['cityCapital']['name'];
    }

    sort($cities);
    $output[] = ['department' => $name, 'municipalities' => $cities];
    echo count($cities) . " municipios\n";
}

// Generar JS
$js = "// Datos completos de Colombia - Departamentos y Municipios\n";
$js .= "// Generado desde api-colombia.com\n";
$js .= "window.COLOMBIA_DATA = " . json_encode($output, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . ";\n";

$filePath = __DIR__ . '/../colombia-data.js';
file_put_contents($filePath, $js);

$totalMunicipios = array_sum(array_map(fn($d) => count($d['municipalities']), $output));
echo "\n✓ ARCHIVO GENERADO: $filePath\n";
echo "  Departamentos: " . count($output) . "\n";
echo "  Total municipios: $totalMunicipios\n";
echo "  Tamaño: " . round(filesize($filePath) / 1024, 1) . " KB\n";
