<?php
declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Method Not Allowed', 405);
}

function loadEnv(): void {
    $envPath = __DIR__ . '/../.env.local';
    if (!file_exists($envPath)) {
        $envPath = __DIR__ . '/../.env';
    }
    if (file_exists($envPath)) {
        $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            if (strpos(trim($line), '#') === 0) {
                continue;
            }
            $parts = explode('=', $line, 2);
            if (count($parts) !== 2) continue;
            $name = trim($parts[0]);
            $value = trim($parts[1]);
            // Remove surrounding quotes
            if (preg_match('/^"(.*)"$/', $value, $matches)) {
                $value = $matches[1];
            } elseif (preg_match('/^\'(.*)\'$/', $value, $matches)) {
                $value = $matches[1];
            }
            if (!getenv($name)) {
                putenv(sprintf('%s=%s', $name, $value));
                $_ENV[$name] = $value;
                $_SERVER[$name] = $value;
            }
        }
    }
}
loadEnv();

require_once __DIR__ . '/db.php';

$db = getDB();
$input = getJsonInput();
$action = $input['action'] ?? '';

try {
    match ($action) {
        'auth_phone' => handleAuthPhone($db, $input),
        'auth_login' => handleAuthLogin($db, $input),
        'auth_register' => handleAuthRegister($db, $input),
        'verify_admin' => handleVerifyAdmin($db, $input),
        'get_session' => handleGetSession($db, $input),
        'send_message' => handleSendMessage($db, $input),
        'get_ai_response' => handleAIResponse($db, $input),
        'list_sessions' => handleListSessions($db, $input),
        'create_pro' => handleCreatePro($db, $input),
        'list_pros' => handleListPros($db),
        'delete_pro' => handleDeletePro($db, $input),
        'delete_session' => handleDeleteSession($db, $input),
        'resolve_case' => handleResolveCase($db, $input),
        'update_admin_key' => handleUpdateAdminKey($db, $input),
        'get_config' => handleGetConfig($db),
        'wipe_db' => handleWipeDB($db),
        'update_session' => handleUpdateSession($db, $input),
        'get_user_count' => handleGetUserCount($db),
        // SMS OTP
        'send_otp' => handleSendOTP($db, $input),
        'verify_otp' => handleVerifyOTP($db, $input),
        // Dashboard charts
        'get_dashboard_stats' => handleDashboardStats($db, $input),
        'get_chart_data' => handleChartData($db, $input),
        // Session summary
        'get_patient_history' => handlePatientHistory($db, $input),
        'save_session_summary' => handleSaveSummary($db, $input),
        // Delete all patients
        'delete_all_clients' => handleDeleteAllClients($db),
        default => jsonError('Unknown action: ' . $action, 400),
    };
} catch (PDOException $e) {
    jsonError('Database error: ' . $e->getMessage(), 500);
} catch (Throwable $e) {
    jsonError('Server error: ' . $e->getMessage(), 500);
}

// ─── HANDLERS ────────────────────────────────────────────

function handleAuthPhone(PDO $db, array $input): void {
    $phone = preg_replace('/\D/', '', $input['phone'] ?? '');
    if (!preg_match('/^3\d{9}$/', $phone)) {
        jsonError('Número inválido. Debe ser un celular Colombia de 10 dígitos.');
    }

    $stmt = $db->prepare('SELECT * FROM users WHERE phone = ?');
    $stmt->execute([$phone]);
    $user = $stmt->fetch();

    if ($user) {
        jsonResponse(['exists' => true, 'user' => $user]);
    } else {
        jsonResponse(['exists' => false]);
    }
}

function handleAuthLogin(PDO $db, array $input): void {
    $userId = $input['userId'] ?? '';
    $pin = $input['pin'] ?? '';

    $stmt = $db->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonError('Usuario no encontrado', 404);
    }

    if (!$user['pin']) {
        $upd = $db->prepare('UPDATE users SET pin = ? WHERE id = ?');
        $upd->execute([$pin, $userId]);
        $user['pin'] = $pin;
        jsonResponse(['success' => true, 'user' => $user]);
        return;
    }

    if ($pin !== $user['pin']) {
        jsonError('PIN incorrecto', 401);
    }

    jsonResponse(['success' => true, 'user' => $user]);
}

function handleAuthRegister(PDO $db, array $input): void {
    $phone = preg_replace('/\D/', '', $input['phone'] ?? '');
    if (!preg_match('/^3\d{9}$/', $phone)) {
        jsonError('Número inválido.');
    }

    $name = trim($input['name'] ?? '');
    $dept = $input['department'] ?? '';
    $muni = $input['municipality'] ?? '';
    $pin = $input['pin'] ?? '';

    if (!$name || !$dept || !$muni || strlen($pin) < 4) {
        jsonError('Completa todos los campos y crea un PIN de 4 dígitos.');
    }

    // Buscar si ya existe un registro (por OTP o previo)
    $stmt = $db->prepare("SELECT * FROM users WHERE phone = ?");
    $stmt->execute([$phone]);
    $existing = $stmt->fetch();

    $now = nowISO();

    if ($existing) {
        // Si ya es un usuario completo (con nombre y PIN), devolverlo
        if (!empty($existing['userName']) && !empty($existing['pin'])) {
            $existing['userName'] = $name; // Actualizar nombre por si cambió
            $db->prepare('UPDATE users SET userName = ?, department = ?, municipality = ? WHERE id = ?')
               ->execute([$name, $dept, $muni, $existing['id']]);
            jsonResponse(['success' => true, 'user' => $existing]);
            return;
        }
        // Es un registro temporal de OTP - actualizarlo
        $userId = $existing['id'];
        $db->prepare('UPDATE users SET userName = ?, department = ?, municipality = ?, pin = ?, role = ?, createdAt = ? WHERE id = ?')
           ->execute([$name, $dept, $muni, $pin, 'patient', $now, $userId]);
    } else {
        // No existe ningún registro - crear uno nuevo
        // (ocurre si el OTP no se usó o se bordeó el flujo)
        $userId = genUUID();
        $db->prepare('INSERT INTO users (id, phone, userName, department, municipality, pin, role, createdAt) VALUES (?,?,?,?,?,?,?,?)')
           ->execute([$userId, $phone, $name, $dept, $muni, $pin, 'patient', $now]);
    }

    // Crear o actualizar sesión
    $stmt = $db->prepare('SELECT id FROM sessions WHERE id = ?');
    $stmt->execute([$userId]);
    $existingSession = $stmt->fetch();

    if (!$existingSession) {
        $welcomeMsg = json_encode([
            ['sender' => 'ai', 'role' => 'model', 'content' => 'Hola. Soy Esperanza, tu compañera de apoyo emocional. Estoy aquí para escucharte sin juzgarte en un espacio seguro. ¿Cómo te sientes hoy?', 'timestamp' => $now]
        ], JSON_UNESCAPED_UNICODE);
        $db->prepare('INSERT INTO sessions (id, userId, userName, department, municipality, phone, createdAt, lastMessageAt, messages, notes, riskLevel) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
           ->execute([$userId, $userId, $name, $dept, $muni, $phone, $now, $now, $welcomeMsg, '', 'low']);
    }

    jsonResponse(['success' => true, 'user' => [
        'id' => $userId, 'phone' => $phone, 'userName' => $name,
        'department' => $dept, 'municipality' => $muni, 'role' => 'patient', 'createdAt' => $now
    ]]);
}

function handleVerifyAdmin(PDO $db, array $input): void {
    $code = $input['code'] ?? '';

    $stmt = $db->prepare("SELECT value FROM system_settings WHERE key = 'adminKey'");
    $stmt->execute();
    $row = $stmt->fetch();
    $adminKey = $row ? $row['value'] : null;

    if ($adminKey && $code === $adminKey) {
        jsonResponse(['success' => true, 'user' => ['id' => 'admin', 'name' => 'Administrador', 'role' => 'admin']]);
        return;
    }

    $stmt = $db->prepare('SELECT * FROM psych_credentials WHERE accessCode = ?');
    $stmt->execute([$code]);
    $cred = $stmt->fetch();

    if (!$cred) {
        jsonError('Código de acceso no válido.', 401);
    }

    jsonResponse(['success' => true, 'user' => [
        'id' => $cred['id'], 'name' => $cred['name'],
        'role' => 'psychologist', 'department' => $cred['department'],
        'municipality' => $cred['municipality']
    ]]);
}

function handleGetSession(PDO $db, array $input): void {
    $id = $input['sessionId'] ?? '';
    $stmt = $db->prepare('SELECT * FROM sessions WHERE id = ?');
    $stmt->execute([$id]);
    $session = $stmt->fetch();

    if (!$session) {
        jsonError('Sesión no encontrada', 404);
    }

    $session['messages'] = json_decode($session['messages'], true) ?? [];
    jsonResponse($session);
}

function handleSendMessage(PDO $db, array $input): void {
    $sessionId = $input['sessionId'] ?? '';
    $sender = $input['sender'] ?? 'user';
    $role = $input['role'] ?? 'user';
    $content = $input['content'] ?? '';
    $userId = $input['userId'] ?? '';

    if (!$content || !$sessionId) {
        jsonError('Missing message or sessionId');
    }

    $stmt = $db->prepare('SELECT * FROM sessions WHERE id = ?');
    $stmt->execute([$sessionId]);
    $session = $stmt->fetch();

    if (!$session) {
        jsonError('Session not found', 404);
    }

    $messages = json_decode($session['messages'], true) ?? [];
    $now = nowISO();

    $msg = [
        'sender' => $sender,
        'role' => $role,
        'content' => $content,
        'timestamp' => $now
    ];
    $messages[] = $msg;

    $riskKeywords = ['suicidio', 'morir', 'matarme', 'fin', 'adiós', 'pastillas', 'cortar', 'ahorcar', 'no quiero vivir'];
    $isHighRisk = false;
    foreach ($riskKeywords as $kw) {
        if (stripos($content, $kw) !== false) { $isHighRisk = true; break; }
    }

    $riskLevel = $isHighRisk ? 'high' : ($session['riskLevel'] ?: 'low');

    $upd = $db->prepare('UPDATE sessions SET messages = ?, lastMessageAt = ?, riskLevel = ? WHERE id = ?');
    $upd->execute([json_encode($messages, JSON_UNESCAPED_UNICODE), $now, $riskLevel, $sessionId]);

    jsonResponse(['success' => true, 'message' => $msg, 'riskLevel' => $riskLevel]);
}

function handleAIResponse(PDO $db, array $input): void {
    $sessionId = $input['sessionId'] ?? '';
    $userMessage = $input['message'] ?? '';

    if (!$userMessage || !$sessionId) {
        jsonError('Missing message or sessionId');
    }

    $groqKey = getenv('GROQ_API_KEY') ?: '';

    if (!$groqKey) {
        jsonResponse(['success' => false, 'local_ai' => true, 'message' => 'No API key configured, use local AI']);
        return;
    }

    $stmt = $db->prepare('SELECT * FROM sessions WHERE id = ?');
    $stmt->execute([$sessionId]);
    $session = $stmt->fetch();

    if (!$session) {
        jsonError('Session not found', 404);
    }

    $messages = json_decode($session['messages'], true) ?? [];

    $history = [];
    foreach ($messages as $m) {
        $txt = $m['content'] ?? ($m['parts'][0]['text'] ?? '');
        if (!$txt || !trim($txt)) continue;
        $r = 'user';
        if (($m['sender'] ?? '') === 'ai' || ($m['role'] ?? '') === 'assistant' || ($m['role'] ?? '') === 'model') {
            $r = 'assistant';
        }
        $history[] = ['role' => $r, 'content' => $txt];
    }

    $systemInstruction = '
Eres "Esperanza", un compañero de apoyo emocional cálido, empático y seguro.
Tu objetivo principal es prevenir el suicidio y ofrecer contención emocional.
Siempre valida los sentimientos del usuario. No juzgues. No diagnostiques.
Si detectas riesgo inmediato de suicidio, insta a llamar a servicios de emergencia.
Usa técnicas de TCC y DBT: reencuadre, grounding, validación.
Tono calmado, esperanzador, paciente, no intrusivo.';

    $payload = json_encode([
        'model' => 'llama-3.3-70b-versatile',
        'messages' => array_merge(
            [['role' => 'system', 'content' => $systemInstruction]],
            $history,
            [['role' => 'user', 'content' => $userMessage]]
        ),
        'temperature' => 0.6,
        'max_tokens' => 1024
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.groq.com/openai/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $groqKey
        ],
        CURLOPT_TIMEOUT => 30,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200 || !$response) {
        jsonResponse(['success' => false, 'local_ai' => true, 'message' => 'Groq API error, use local AI']);
        return;
    }

    $result = json_decode($response, true);
    $aiText = $result['choices'][0]['message']['content'] ?? '';

    if (!$aiText) {
        jsonResponse(['success' => false, 'local_ai' => true, 'message' => 'Groq empty response, use local AI']);
        return;
    }

    $now = nowISO();
    $aiMsg = ['sender' => 'ai', 'role' => 'assistant', 'content' => $aiText, 'timestamp' => $now];
    $messages[] = $aiMsg;

    $upd = $db->prepare('UPDATE sessions SET messages = ?, lastMessageAt = ? WHERE id = ?');
    $upd->execute([json_encode($messages, JSON_UNESCAPED_UNICODE), $now, $sessionId]);

    jsonResponse(['success' => true, 'message' => $aiMsg]);
}


function handleListSessions(PDO $db, array $input): void {
    $role = $input['role'] ?? 'psychologist';
    $department = $input['department'] ?? '';
    $municipality = $input['municipality'] ?? '';

    if ($role === 'admin') {
        $stmt = $db->query('SELECT * FROM sessions ORDER BY lastMessageAt DESC');
    } else {
        $stmt = $db->prepare('SELECT * FROM sessions WHERE department = ? AND municipality = ? ORDER BY lastMessageAt DESC');
        $stmt->execute([$department, $municipality]);
    }
    $sessions = $stmt->fetchAll();

    foreach ($sessions as &$s) {
        $msgs = json_decode($s['messages'], true) ?? [];
        $s['messages'] = $msgs;
        $s['messageCount'] = count($msgs);
    }

    jsonResponse($sessions);
}

function handleCreatePro(PDO $db, array $input): void {
    $name = trim($input['name'] ?? '');
    $dept = $input['department'] ?? '';
    $muni = $input['municipality'] ?? '';

    if (!$name || !$dept || !$muni) {
        jsonError('Completa todos los campos.');
    }

    $id = genUUID();
    $accessCode = 'PRO-' . str_pad((string)random_int(1000, 9999), 4, '0', STR_PAD_LEFT);
    $now = nowISO();

    $db->prepare('INSERT INTO psych_credentials (id, name, department, municipality, accessCode, createdAt) VALUES (?,?,?,?,?,?)')
       ->execute([$id, $name, $dept, $muni, $accessCode, $now]);

    jsonResponse(['success' => true, 'accessCode' => $accessCode, 'id' => $id]);
}

function handleListPros(PDO $db): void {
    $stmt = $db->query('SELECT * FROM psych_credentials ORDER BY createdAt DESC');
    jsonResponse($stmt->fetchAll());
}

function handleDeletePro(PDO $db, array $input): void {
    $id = $input['id'] ?? '';
    $db->prepare('DELETE FROM psych_credentials WHERE id = ?')->execute([$id]);
    jsonResponse(['success' => true]);
}

function handleDeleteSession(PDO $db, array $input): void {
    $id = $input['id'] ?? '';
    $db->prepare('DELETE FROM sessions WHERE id = ?')->execute([$id]);
    jsonResponse(['success' => true]);
}

function handleResolveCase(PDO $db, array $input): void {
    $id = $input['id'] ?? '';
    $db->prepare('DELETE FROM sessions WHERE id = ? OR userId = ?')->execute([$id, $id]);
    $db->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    jsonResponse(['success' => true]);
}

function handleUpdateAdminKey(PDO $db, array $input): void {
    $newKey = $input['adminKey'] ?? '';
    if (strlen($newKey) < 5) {
        jsonError('La clave debe tener al menos 5 caracteres.');
    }
    $db->prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('adminKey', ?)")->execute([$newKey]);
    jsonResponse(['success' => true]);
}

function handleGetConfig(PDO $db): void {
    $stmt = $db->query('SELECT * FROM system_settings');
    $rows = $stmt->fetchAll();
    $config = [];
    foreach ($rows as $r) {
        $config[$r['key']] = $r['value'];
    }
    // Incluir si hay Twilio configurado
    $config['twilio_configured'] = !empty(getenv('TWILIO_SID')) && !empty(getenv('TWILIO_TOKEN'));
    jsonResponse($config);
}

function handleWipeDB(PDO $db): void {
    $db->exec('DELETE FROM sessions');
    $db->exec('DELETE FROM users');
    $db->exec('DELETE FROM psych_credentials');
    jsonResponse(['success' => true]);
}

function handleUpdateSession(PDO $db, array $input): void {
    $id = $input['sessionId'] ?? '';
    $fields = [];

    if (array_key_exists('attendedBy', $input)) $fields['attendedBy'] = $input['attendedBy'];
    if (array_key_exists('psychName', $input)) $fields['psychName'] = $input['psychName'];
    if (array_key_exists('notes', $input)) $fields['notes'] = $input['notes'];
    if (array_key_exists('riskLevel', $input)) $fields['riskLevel'] = $input['riskLevel'];
    if (array_key_exists('messages', $input)) $fields['messages'] = json_encode($input['messages'], JSON_UNESCAPED_UNICODE);
    if (array_key_exists('sessionSummary', $input)) $fields['sessionSummary'] = $input['sessionSummary'];

    if (empty($fields)) {
        jsonError('No fields to update');
    }

    $setParts = [];
    $params = [];
    foreach ($fields as $k => $v) {
        $setParts[] = "$k = ?";
        $params[] = $v;
    }
    $params[] = $id;

    $db->prepare('UPDATE sessions SET ' . implode(', ', $setParts) . ' WHERE id = ?')->execute($params);
    jsonResponse(['success' => true]);
}

function handleGetUserCount(PDO $db): void {
    $total = $db->query('SELECT COUNT(*) as c FROM users')->fetch()['c'];
    jsonResponse(['total' => $total]);
}

function handleDeleteAllClients(PDO $db): void {
    // Eliminar TODAS las sesiones
    $db->exec('DELETE FROM sessions');
    // Eliminar SOLO usuarios con rol patient (conserva admins y pros)
    $db->exec("DELETE FROM users WHERE role = 'patient'");
    // También eliminar pacientes que no tengan rol (registros huérfanos de OTP)
    $db->exec("DELETE FROM users WHERE role IS NULL OR role = ''");
    jsonResponse(['success' => true, 'message' => 'Todos los pacientes y sus datos han sido eliminados.']);
}

// ─── SMS OTP ────────────────────────────────────────────

function handleSendOTP(PDO $db, array $input): void {
    $phone = preg_replace('/\D/', '', $input['phone'] ?? '');
    if (!preg_match('/^3\d{9}$/', $phone)) {
        jsonError('Número inválido.');
    }

    $otp = (string)random_int(100000, 999999);
    $expires = date('c', strtotime('+5 minutes'));

    // Guardar OTP en el usuario (si existe) o crear registro temporal
    $stmt = $db->prepare('SELECT id FROM users WHERE phone = ?');
    $stmt->execute([$phone]);
    $existing = $stmt->fetch();

    if ($existing) {
        $upd = $db->prepare("UPDATE users SET otpCode = ?, otpExpires = ?, otpVerified = '0' WHERE phone = ?");
        $upd->execute([$otp, $expires, $phone]);
    } else {
        // Pre-registro temporal para usuarios nuevos
        $id = genUUID();
        $now = nowISO();
        $db->prepare("INSERT INTO users (id, phone, userName, otpCode, otpExpires, role, createdAt) VALUES (?,?,?,?,?,?,?)")
           ->execute([$id, $phone, '', $otp, $expires, 'patient', $now]);
    }

    // Intentar enviar SMS via Twilio
    $twilioSid = getenv('TWILIO_SID') ?: '';
    $twilioToken = getenv('TWILIO_TOKEN') ?: '';
    $twilioFrom = getenv('TWILIO_FROM') ?: '';

    if ($twilioSid && $twilioToken && $twilioFrom) {
        $sent = sendTwilioSMS($phone, $twilioSid, $twilioToken, $twilioFrom, "Tu código de verificación de Luz y Vida es: $otp. Válido por 5 minutos.");
        if ($sent) {
            jsonResponse(['success' => true, 'message' => 'Código enviado por SMS.']);
            return;
        }
    }

    // Fallback: modo desarrollo - mostrar código
    jsonResponse([
        'success' => true,
        'message' => 'Modo desarrollo: código mostrado.',
        'debug_otp' => $otp,
        'dev_mode' => true
    ]);
}

function handleVerifyOTP(PDO $db, array $input): void {
    $phone = preg_replace('/\D/', '', $input['phone'] ?? '');
    $code = $input['code'] ?? '';

    if (!$phone || !$code) {
        jsonError('Teléfono y código requeridos.');
    }

    $stmt = $db->prepare("SELECT otpCode, otpExpires FROM users WHERE phone = ?");
    $stmt->execute([$phone]);
    $user = $stmt->fetch();

    if (!$user || !$user['otpCode']) {
        jsonError('No hay código pendiente. Solicita uno nuevo.');
    }

    if ($user['otpCode'] !== $code) {
        jsonError('Código incorrecto.');
    }

    if (strtotime($user['otpExpires']) < time()) {
        jsonError('Código expirado. Solicita uno nuevo.');
    }

    $upd = $db->prepare("UPDATE users SET otpVerified = '1', otpCode = NULL, otpExpires = NULL WHERE phone = ?");
    $upd->execute([$phone]);

    jsonResponse(['success' => true, 'message' => 'Número verificado correctamente.']);
}

function sendTwilioSMS(string $to, string $sid, string $token, string $from, string $body): bool {
    $url = "https://api.twilio.com/2010-04-01/Accounts/$sid/Messages.json";
    $data = [
        'From' => $from,
        'To' => '+57' . $to,
        'Body' => $body
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($data),
        CURLOPT_USERPWD => "$sid:$token",
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return $httpCode === 201;
}

// ─── DASHBOARD STATS ─────────────────────────────────────

function handleDashboardStats(PDO $db, array $input): void {
    $role = $input['role'] ?? 'admin';
    $department = $input['department'] ?? '';
    $municipality = $input['municipality'] ?? '';

    if ($role === 'admin') {
        $totalUsers = $db->query('SELECT COUNT(*) as c FROM users')->fetch()['c'];
        $totalSessions = $db->query('SELECT COUNT(*) as c FROM sessions')->fetch()['c'];
        $highRisk = $db->query("SELECT COUNT(*) as c FROM sessions WHERE riskLevel = 'high'")->fetch()['c'];
        $totalMessages = $db->query("SELECT SUM(LENGTH(messages) - LENGTH(REPLACE(messages, 'content', ''))) / 7 as c FROM sessions")->fetch()['c'];
    } else {
        $stmt = $db->prepare('SELECT COUNT(*) as c FROM users WHERE department = ? AND municipality = ?');
        $stmt->execute([$department, $municipality]);
        $totalUsers = $stmt->fetch()['c'];

        $stmt = $db->prepare('SELECT COUNT(*) as c FROM sessions WHERE department = ? AND municipality = ?');
        $stmt->execute([$department, $municipality]);
        $totalSessions = $stmt->fetch()['c'];

        $stmt = $db->prepare("SELECT COUNT(*) as c FROM sessions WHERE department = ? AND municipality = ? AND riskLevel = 'high'");
        $stmt->execute([$department, $municipality]);
        $highRisk = $stmt->fetch()['c'];
        $totalMessages = 0;
    }

    // Sesiones por día (últimos 7 días)
    $dailySessions = [];
    for ($i = 6; $i >= 0; $i--) {
        $day = date('Y-m-d', strtotime("-$i days"));
        $stmt = $db->prepare("SELECT COUNT(*) as c FROM sessions WHERE DATE(lastMessageAt) = ?");
        $stmt->execute([$day]);
        $dailySessions[] = ['date' => $day, 'count' => (int)$stmt->fetch()['c']];
    }

    jsonResponse([
        'totalUsers' => (int)$totalUsers,
        'totalSessions' => (int)$totalSessions,
        'highRisk' => (int)$highRisk,
        'totalMessages' => (int)$totalMessages,
        'dailySessions' => $dailySessions
    ]);
}

function handleChartData(PDO $db, array $input): void {
    $role = $input['role'] ?? 'admin';
    $department = $input['department'] ?? '';
    $municipality = $input['municipality'] ?? '';

    if ($role === 'admin') {
        $sessions = $db->query('SELECT * FROM sessions')->fetchAll();
    } else {
        $stmt = $db->prepare('SELECT * FROM sessions WHERE department = ? AND municipality = ?');
        $stmt->execute([$department, $municipality]);
        $sessions = $stmt->fetchAll();
    }

    // Riesgo
    $riskStats = ['high' => 0, 'medium' => 0, 'low' => 0];
    // Departamentos
    $deptStats = [];
    // Profesionales activos
    $proActive = [];

    foreach ($sessions as $s) {
        $r = $s['riskLevel'] ?: 'low';
        if (isset($riskStats[$r])) $riskStats[$r]++;
        $d = $s['department'] ?: 'Desconocido';
        $deptStats[$d] = ($deptStats[$d] ?? 0) + 1;
        if ($s['psychName']) {
            $proActive[$s['psychName']] = ($proActive[$s['psychName']] ?? 0) + 1;
        }
    }

    jsonResponse([
        'riskStats' => $riskStats,
        'deptStats' => $deptStats,
        'proActive' => $proActive,
        'total' => count($sessions)
    ]);
}

function handlePatientHistory(PDO $db, array $input): void {
    $userId = $input['userId'] ?? '';
    if (!$userId) jsonError('userId requerido');

    // Obtener sesiones anteriores del mismo paciente
    $stmt = $db->prepare("SELECT id, createdAt, lastMessageAt, sessionSummary, riskLevel, messageCount FROM sessions WHERE userId = ? ORDER BY createdAt DESC");
    $stmt->execute([$userId]);
    $sessions = $stmt->fetchAll();

    // También obtener resúmenes de sesiones previas
    $summaries = [];
    foreach ($sessions as $s) {
        if (!empty($s['sessionSummary'])) {
            $summaries[] = $s['sessionSummary'];
        }
    }

    jsonResponse([
        'sessions' => $sessions,
        'summaries' => $summaries
    ]);
}

function handleSaveSummary(PDO $db, array $input): void {
    $sessionId = $input['sessionId'] ?? '';
    $summary = $input['summary'] ?? '';

    if (!$sessionId || !$summary) {
        jsonError('sessionId y summary requeridos');
    }

    $db->prepare('UPDATE sessions SET sessionSummary = ? WHERE id = ?')
       ->execute([$summary, $sessionId]);

    jsonResponse(['success' => true]);
}
