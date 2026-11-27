<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('audit_jobs', function (Blueprint $table): void {
            if (!Schema::hasColumn('audit_jobs', 'target_host')) {
                $table->text('target_host')->nullable();
            }
            if (!Schema::hasColumn('audit_jobs', 'audit_options_json')) {
                $table->text('audit_options_json')->nullable();
            }
        });

        DB::statement('CREATE INDEX IF NOT EXISTS audit_jobs_host_idx ON audit_jobs(target_host, status, finished_at)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS audit_jobs_host_idx');

        Schema::table('audit_jobs', function (Blueprint $table): void {
            $toDrop = [];
            if (Schema::hasColumn('audit_jobs', 'target_host')) {
                $toDrop[] = 'target_host';
            }
            if (Schema::hasColumn('audit_jobs', 'audit_options_json')) {
                $toDrop[] = 'audit_options_json';
            }
            if ($toDrop !== []) {
                $table->dropColumn($toDrop);
            }
        });
    }
};
