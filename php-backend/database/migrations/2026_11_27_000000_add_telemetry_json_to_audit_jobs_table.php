<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('audit_jobs', 'telemetry_json')) {
            Schema::table('audit_jobs', function (Blueprint $table): void {
                $table->text('telemetry_json')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('audit_jobs', 'telemetry_json')) {
            Schema::table('audit_jobs', function (Blueprint $table): void {
                $table->dropColumn('telemetry_json');
            });
        }
    }
};
