<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Also upgrades databases created by older JobStore startup DDL.
        foreach (['lease_token', 'lease_expires_at'] as $column) {
            if (!Schema::hasColumn('audit_jobs', $column)) {
                Schema::table('audit_jobs', function (Blueprint $table) use ($column): void {
                    if ($column === 'lease_token') {
                        $table->text($column)->nullable();
                    } else {
                        $table->bigInteger($column)->nullable();
                    }
                });
            }
        }
    }

    public function down(): void
    {
        // Columns can predate this migration; preserve existing lease state on rollback.
    }
};
