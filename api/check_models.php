<?php
// Script to test available Gemini models
$key = "AIzaSyDXBKW7zrpbTZ9JYuxEIkuCNiP_lJIZjP8"; 
$url = "https://generativelanguage.googleapis.com/v1beta/models?key=" . $key;
$opts = [
    "http" => [
        "method" => "GET",
        "ignore_errors" => true
    ]
];
$context = stream_context_create($opts);
$response = file_get_contents($url, false, $context);
$data = json_decode($response, true);
if (isset($data['models'])) {
    foreach ($data['models'] as $model) {
        if (in_array("generateContent", $model['supportedGenerationMethods'])) {
             echo $model['name'] . "\n";
        }
    }
} else {
    echo "No models found or error: " . $response;
}
?>
