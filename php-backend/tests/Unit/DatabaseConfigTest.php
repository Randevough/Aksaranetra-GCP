<?php

declare(strict_types=1);

namespace Tests\Unit;

use Tests\TestCase;

class DatabaseConfigTest extends TestCase
{
    public function test_postgres_root_certificate_is_passed_to_connector(): void
    {
        $old = getenv('DB_SSLROOTCERT');
        putenv('DB_SSLROOTCERT=/certs/server-ca.pem');
        try {
            $config = require base_path('config/database.php');
            $this->assertSame('/certs/server-ca.pem', $config['connections']['pgsql']['sslrootcert']);
        } finally {
            putenv($old === false ? 'DB_SSLROOTCERT' : 'DB_SSLROOTCERT=' . $old);
        }
    }
}
