<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Http\Request;

class SecurityService
{
    public const MAX_URL_LENGTH = 2048;

    private const ALLOWED_PROTOCOLS = ['http', 'https'];
    private const DEFAULT_PORTS = ['http' => 80, 'https' => 443];
    private const BLOCKED_HOSTS = [
        'localhost',
        'localhost.localdomain',
        'metadata.google.internal',
        'instance-data',
        'metadata',
    ];
    private const BLOCKED_HOST_SUFFIXES = [
        '.localhost',
        '.local',
        '.internal',
        '.intranet',
        '.lan',
        '.home.arpa',
        '.metadata.google.internal',
    ];
    private const HOSTNAME_SHAPE = '/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/';

    /**
     * Validate a raw URL against SSRF and domain-shape rules without spawning Node.
     *
     * @return array{ok: bool, code: ?string, message: ?string, url?: string, hostname?: string, protocol?: string}
     */
    public static function checkUrl(?string $raw): array
    {
        $trimmed = trim((string) ($raw ?? ''));

        if ($trimmed === '') {
            return self::denyUrl('empty-url', 'URL kosong.');
        }

        if (strlen($trimmed) > self::MAX_URL_LENGTH) {
            return self::denyUrl('url-too-long', 'URL lebih panjang dari ' . self::MAX_URL_LENGTH . ' karakter.');
        }

        if (preg_match('/[\x00-\x20\x7F]/', $trimmed)) {
            return self::denyUrl('unparseable-url', 'URL tidak dapat dibaca.');
        }

        if (!preg_match('/^([a-zA-Z][a-zA-Z0-9+.-]*):/s', $trimmed, $schemeMatch)) {
            return self::denyUrl('unparseable-url', 'URL tidak dapat dibaca.');
        }

        $scheme = strtolower($schemeMatch[1]);
        if (!in_array($scheme, self::ALLOWED_PROTOCOLS, true)) {
            return self::denyUrl('protocol-not-allowed', "Hanya http dan https yang didukung, bukan {$scheme}.");
        }

        if (!preg_match('#^https?://([^/?\#]+)#i', $trimmed, $authorityMatch)) {
            return self::denyUrl('unparseable-url', 'URL tidak dapat dibaca.');
        }

        $parts = parse_url($trimmed);
        if (!is_array($parts) || !isset($parts['host']) || $parts['host'] === '') {
            return self::denyUrl('unparseable-url', 'URL tidak dapat dibaca.');
        }

        if (
            isset($parts['user'])
            || isset($parts['pass'])
            || str_contains($authorityMatch[1], '@')
        ) {
            return self::denyUrl('credentials-in-url', 'URL memuat nama pengguna atau kata sandi.');
        }

        if (isset($parts['port'])) {
            $port = (int) $parts['port'];
            if ($port !== self::DEFAULT_PORTS[$scheme]) {
                return self::denyUrl('port-not-allowed', "Hanya port standar yang diizinkan, bukan port {$port}.");
            }
        }

        $hostname = strtolower((string) $parts['host']);
        if (str_starts_with($hostname, '[') && str_ends_with($hostname, ']')) {
            return self::denyUrl('ip-literal-not-allowed', 'Alamat IP langsung tidak diterima. Gunakan nama domain.');
        }

        if (str_ends_with($hostname, '.')) {
            $hostname = substr($hostname, 0, -1);
        }

        if ($hostname === '') {
            return self::denyUrl('empty-host', 'URL tidak memuat nama domain.');
        }

        if (str_contains($hostname, ':') || filter_var($hostname, FILTER_VALIDATE_IP) !== false || self::isWhatwgIpv4Literal($hostname)) {
            return self::denyUrl('ip-literal-not-allowed', 'Alamat IP langsung tidak diterima. Gunakan nama domain.');
        }

        if (in_array($hostname, self::BLOCKED_HOSTS, true)) {
            return self::denyUrl('local-host-name', "Nama {$hostname} mengarah ke mesin lokal.");
        }

        foreach (self::BLOCKED_HOST_SUFFIXES as $suffix) {
            if (str_ends_with($hostname, $suffix)) {
                return self::denyUrl('local-host-name', "Akhiran {$suffix} dipakai untuk jaringan lokal.");
            }
        }

        if (preg_match('/[^\x20-\x7E]/', $hostname) && function_exists('idn_to_ascii')) {
            $ascii = idn_to_ascii($hostname, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
            if (is_string($ascii) && $ascii !== '') {
                $hostname = strtolower($ascii);
            }
        }

        if (!preg_match(self::HOSTNAME_SHAPE, $hostname)) {
            return self::denyUrl('hostname-not-allowed', 'Nama domain tidak berbentuk wajar.');
        }

        $path = $parts['path'] ?? '/';
        if ($path === '') {
            $path = '/';
        }
        $query = isset($parts['query']) && $parts['query'] !== '' ? '?' . $parts['query'] : '';

        return [
            'ok' => true,
            'code' => null,
            'message' => null,
            'url' => "{$scheme}://{$hostname}{$path}{$query}",
            'hostname' => $hostname,
            'protocol' => "{$scheme}:",
        ];
    }

    private static function denyUrl(string $code, string $message): array
    {
        return [
            'ok' => false,
            'code' => $code,
            'message' => $message,
        ];
    }

    /**
     * Detect decimal, hex, octal, or shorthand IPv4 notations resolved by WHATWG URL parsers.
     */
    private static function isWhatwgIpv4Literal(string $hostname): bool
    {
        $parts = explode('.', $hostname);
        $count = count($parts);
        if ($count < 1 || $count > 4) {
            return false;
        }

        $values = [];
        foreach ($parts as $part) {
            if ($part === '') {
                return false;
            }
            if (preg_match('/^0x([0-9a-f]+)$/i', $part, $m)) {
                $val = hexdec($m[1]);
            } elseif (preg_match('/^0([0-7]*)$/', $part, $m)) {
                $val = $m[1] === '' ? 0 : octdec($m[1]);
            } elseif (preg_match('/^[1-9][0-9]*$/', $part)) {
                $val = (float) $part;
            } else {
                return false;
            }
            $values[] = $val;
        }

        for ($i = 0; $i < $count - 1; $i++) {
            if ($values[$i] > 255) {
                return false;
            }
        }

        $maxLast = 256 ** (5 - $count);
        return $values[$count - 1] < $maxLast;
    }
    /**
     * Convert binary string to base64url encoding (RFC 4648 §5, without padding).
     */
    public static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    /**
     * Generate a cryptographically secure random token in base64url format.
     */
    public static function randomToken(int $bytes = 32): string
    {
        return self::base64UrlEncode(random_bytes($bytes));
    }

    /**
     * Generate a random job ID prefixed with 'aud_' followed by 18 random bytes (base64url).
     */
    public static function randomJobId(): string
    {
        return 'aud_' . self::base64UrlEncode(random_bytes(18));
    }

    /**
     * Compute HMAC-SHA256 hex digest for a value using the given secret.
     */
    public static function digest(string|int|float $value, string $secret): string
    {
        return hash_hmac('sha256', (string) $value, $secret);
    }

    /**
     * Derive a share token for a job using HMAC-SHA256 of "share:{jobId}:{accessToken}".
     * Returns base64url encoded raw digest.
     */
    public static function deriveShareToken(string|array $jobId, ?string $accessToken = null, ?string $secret = null): string
    {
        if (is_array($jobId)) {
            $secret = $jobId['secret'] ?? $secret;
            $accessToken = $jobId['accessToken'] ?? $accessToken;
            $jobId = $jobId['jobId'] ?? '';
        }

        if ($accessToken === null || $secret === null) {
            throw new \InvalidArgumentException('deriveShareToken requires jobId, accessToken, and secret.');
        }

        $rawHmac = hash_hmac('sha256', "share:{$jobId}:{$accessToken}", $secret, true);
        return self::base64UrlEncode($rawHmac);
    }

    /**
     * Constant-time comparison of two hex strings.
     */
    public static function safeEqualHex(?string $left, ?string $right): bool
    {
        if ($left === null || $right === null || $left === '' || $right === '') {
            return false;
        }

        if (strlen($left) !== strlen($right)) {
            return false;
        }

        return hash_equals($left, $right);
    }

    /**
     * Extract client IP from request, taking TRUST_PROXY into account.
     */
    public static function clientIp(mixed $request, bool|object $trustProxy = false): string
    {
        $shouldTrust = is_object($trustProxy) ? (bool) ($trustProxy->trustProxy ?? false) : (bool) $trustProxy;
        if ($shouldTrust) {
            $forwarded = null;
            if ($request instanceof Request) {
                $forwarded = $request->header('x-forwarded-for');
            } elseif (is_array($request)) {
                $headers = $request['headers'] ?? $request;
                $forwarded = $headers['x-forwarded-for'] ?? $headers['X-Forwarded-For'] ?? null;
            } elseif (is_object($request)) {
                if (isset($request->headers)) {
                    $headers = is_array($request->headers) ? $request->headers : (array) $request->headers;
                    $forwarded = $headers['x-forwarded-for'] ?? $headers['X-Forwarded-For'] ?? null;
                }
            }

            if (is_array($forwarded)) {
                $forwarded = $forwarded[0] ?? null;
            }

            if (is_string($forwarded) && $forwarded !== '') {
                $parts = explode(',', $forwarded);
                $first = trim($parts[0]);
                if ($first !== '') {
                    return $first;
                }
            }
        }

        if ($request instanceof Request) {
            return $request->server('REMOTE_ADDR') ?? $request->ip() ?? 'unknown';
        }

        if (is_array($request)) {
            if (isset($request['socket']['remoteAddress'])) {
                return (string) $request['socket']['remoteAddress'];
            }
            if (isset($request['remoteAddress'])) {
                return (string) $request['remoteAddress'];
            }
        }

        if (is_object($request)) {
            if (isset($request->socket->remoteAddress)) {
                return (string) $request->socket->remoteAddress;
            }
        }

        return 'unknown';
    }

    /**
     * Extract bearer token from Authorization header or accessToken query parameter.
     */
    public static function bearerToken(mixed $request, mixed $url = null): string
    {
        $header = '';
        if ($request instanceof Request) {
            $header = $request->header('authorization', '');
            if (str_starts_with($header, 'Bearer ')) {
                return trim(substr($header, 7));
            }
            return (string) $request->query('accessToken', '');
        }

        if (is_array($request)) {
            $headers = $request['headers'] ?? $request;
            $header = $headers['authorization'] ?? $headers['Authorization'] ?? '';
        } elseif (is_object($request) && isset($request->headers)) {
            $headers = is_array($request->headers) ? $request->headers : (array) $request->headers;
            $header = $headers['authorization'] ?? $headers['Authorization'] ?? '';
        }

        if (is_string($header) && str_starts_with($header, 'Bearer ')) {
            return trim(substr($header, 7));
        }

        if ($url instanceof \Psr\Http\Message\UriInterface || (is_object($url) && method_exists($url, '__toString'))) {
            parse_str(parse_url((string) $url, PHP_URL_QUERY) ?? '', $query);
            return (string) ($query['accessToken'] ?? '');
        }

        if (is_string($url)) {
            parse_str(parse_url($url, PHP_URL_QUERY) ?? '', $query);
            return (string) ($query['accessToken'] ?? '');
        }

        return '';
    }
}
