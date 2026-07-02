<?php
declare(strict_types=1);

define('DB_PATH', __DIR__ . '/../lyv.db');

function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO('sqlite:' . DB_PATH);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA journal_mode=WAL');
        $pdo->exec('PRAGMA foreign_keys=ON');
        initSchema($pdo);
    }
    return $pdo;
}

function initSchema(PDO $pdo): void {
    $pdo->exec('
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            phone TEXT UNIQUE NOT NULL,
            userName TEXT NOT NULL,
            department TEXT,
            municipality TEXT,
            pin TEXT,
            otpCode TEXT,
            otpExpires TEXT,
            otpVerified TEXT DEFAULT "0",
            role TEXT NOT NULL DEFAULT "patient",
            createdAt TEXT NOT NULL
        )
    ');
    $pdo->exec('
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            userName TEXT,
            department TEXT,
            municipality TEXT,
            phone TEXT,
            createdAt TEXT NOT NULL,
            lastMessageAt TEXT NOT NULL,
            messages TEXT NOT NULL DEFAULT "[]",
            notes TEXT DEFAULT "",
            sessionSummary TEXT DEFAULT "",
            riskLevel TEXT NOT NULL DEFAULT "low",
            attendedBy TEXT,
            psychName TEXT
        )
    ');
    $pdo->exec('
        CREATE TABLE IF NOT EXISTS psych_credentials (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            department TEXT,
            municipality TEXT,
            accessCode TEXT UNIQUE NOT NULL,
            createdAt TEXT NOT NULL,
            fcmToken TEXT DEFAULT ""
        )
    ');
    $pdo->exec('
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ');

    // Migraciones para tablas existentes
    try { $pdo->exec("ALTER TABLE users ADD COLUMN otpCode TEXT"); } catch (PDOException $e) {}
    try { $pdo->exec("ALTER TABLE users ADD COLUMN otpExpires TEXT"); } catch (PDOException $e) {}
    try { $pdo->exec("ALTER TABLE users ADD COLUMN otpVerified TEXT DEFAULT '0'"); } catch (PDOException $e) {}
    try { $pdo->exec("ALTER TABLE sessions ADD COLUMN sessionSummary TEXT DEFAULT ''"); } catch (PDOException $e) {}
}

function jsonResponse(mixed $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonError(string $message, int $code = 400): void {
    jsonResponse(['error' => $message], $code);
}

function getJsonInput(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        jsonError('Invalid JSON body', 400);
    }
    return $data;
}

function genUUID(): string {
    return sprintf(
        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

function nowISO(): string {
    return date('c');
}

function sanitize(mixed $val): string {
    return htmlspecialchars((string)$val, ENT_QUOTES, 'UTF-8');
}
