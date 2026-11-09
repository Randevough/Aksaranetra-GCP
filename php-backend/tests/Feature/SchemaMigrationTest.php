<?php

declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class SchemaMigrationTest extends TestCase
{
    public function test_migrations_create_and_upgrade_lease_columns_without_losing_rows(): void
    {
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
        DB::purge('sqlite');
        $create = require database_path('migrations/2026_10_14_000000_create_audit_jobs_table.php');
        $upgrade = require database_path('migrations/2026_11_09_000000_add_audit_job_leases.php');
        $create->up();
        $this->assertTrue(Schema::hasColumns('audit_jobs', ['lease_token', 'lease_expires_at']));
        Schema::dropColumns('audit_jobs', ['lease_token', 'lease_expires_at']);
        DB::table('audit_jobs')->insert([
            'id' => 'keep', 'token_hash' => 'a', 'share_token_hash' => 'b', 'ip_hash' => 'c',
            'target_url' => 'https://example.com', 'status' => 'queued', 'stage' => 'queued',
            'progress' => 0, 'created_at' => 1, 'updated_at' => 1, 'expires_at' => 2, 'artifact_dir' => '/unused',
        ]);
        $upgrade->up();
        $upgrade->up();
        $this->assertTrue(Schema::hasColumns('audit_jobs', ['lease_token', 'lease_expires_at']));
        $this->assertSame('keep', DB::table('audit_jobs')->value('id'));
    }
}
