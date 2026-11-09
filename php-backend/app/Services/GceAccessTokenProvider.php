<?php

declare(strict_types=1);

namespace App\Services;

use GuzzleHttp\ClientInterface;
use RuntimeException;
use Throwable;

final class GceAccessTokenProvider
{
    private const TOKEN_URL = 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';
    private string $token = '';
    private int $refreshAt = 0;

    public function __construct(
        private readonly ClientInterface $http,
        private readonly mixed $clock = null
    ) {}

    public function __invoke(): string
    {
        $now = $this->clock === null ? time() : ($this->clock)();
        if ($this->token !== '' && $now < $this->refreshAt) {
            return $this->token;
        }

        $this->token = '';
        $this->refreshAt = 0;
        try {
            $response = $this->http->request('GET', self::TOKEN_URL, [
                'headers' => ['Metadata-Flavor' => 'Google'],
                'timeout' => 2,
                'connect_timeout' => 1,
                'allow_redirects' => false,
                'proxy' => '',
                'http_errors' => false,
            ]);
            $data = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
            if ($response->getStatusCode() !== 200
                || !is_array($data)
                || !is_string($data['access_token'] ?? null)
                || !preg_match('/\A[A-Za-z0-9._~+\/-]+=*\z/D', $data['access_token'])
                || ($data['token_type'] ?? null) !== 'Bearer'
                || !is_int($data['expires_in'] ?? null)
                || $data['expires_in'] <= 0
                || $data['expires_in'] > 86400) {
                throw new RuntimeException();
            }
        } catch (Throwable) {
            // Do not chain HTTP exceptions: response bodies may contain credentials.
            throw new RuntimeException('VM identity token unavailable');
        }

        $this->token = $data['access_token'];
        $this->refreshAt = $now + max(0, $data['expires_in'] - 30);
        return $this->token;
    }
}
