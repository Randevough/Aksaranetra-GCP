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
        $telemetryUpgrade = require database_path('migrations/2026_11_27_000000_add_telemetry_json_to_audit_jobs_table.php');
        $wave2Upgrade = require database_path('migrations/2026_11_28_000000_add_wave2_columns_to_audit_jobs_table.php');
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
        $telemetryUpgrade->up();
        $telemetryUpgrade->up();
        $wave2Upgrade->up();
        $wave2Upgrade->up();
        $this->assertTrue(Schema::hasColumns('audit_jobs', [
            'lease_token',
            'lease_expires_at',
            'telemetry_json',
            'target_host',
            'audit_options_json',
        ]));
        $indexes = array_column(DB::select("PRAGMA index_list('audit_jobs')"), 'name');
        $this->assertContains('audit_jobs_host_idx', $indexes);
        $this->assertSame('keep', DB::table('audit_jobs')->value('id'));
    }

    public function test_job_store_sqlite_alter_guard_adds_wave2_columns_and_host_index(): void
    {
        $pdo = new \PDO('sqlite::memory:');
        $pdo->exec("CREATE TABLE audit_jobs (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL,
            share_token_hash TEXT NOT NULL,
            ip_hash TEXT NOT NULL,
            target_url TEXT NOT NULL,
            status TEXT NOT NULL,
            stage TEXT NOT NULL,
            progress INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            cancel_requested INTEGER NOT NULL DEFAULT 0,
            result_json TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            started_at BIGINT,
            finished_at BIGINT,
            expires_at BIGINT NOT NULL,
            artifact_dir TEXT NOT NULL,
            lease_token TEXT,
            lease_expires_at BIGINT
        )");

        new \App\Services\JobStore($pdo);
        $columns = array_column($pdo->query('PRAGMA table_info(audit_jobs)')->fetchAll(\PDO::FETCH_ASSOC), 'name');
        $this->assertContains('telemetry_json', $columns);
        $this->assertContains('target_host', $columns);
        $this->assertContains('audit_options_json', $columns);

        $indexes = array_column($pdo->query("PRAGMA index_list('audit_jobs')")->fetchAll(\PDO::FETCH_ASSOC), 'name');
        $this->assertContains('audit_jobs_host_idx', $indexes);
    }
}
