<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\JobStore;
use PDO;
use PHPUnit\Framework\TestCase;

class PostgresStartupTest extends TestCase
{
    public function test_postgres_constructor_never_executes_schema_or_recovery_sql(): void
    {
        $pdo = new class extends PDO {
            public array $statements = [];
            public function __construct() {}
            public function getAttribute(int $attribute): mixed { return 'pgsql'; }
            public function exec(string $statement): int|false
            {
                $this->statements[] = $statement;
                return 0;
            }
        };
        new JobStore($pdo);
        $this->assertSame([], $pdo->statements);
    }
}
