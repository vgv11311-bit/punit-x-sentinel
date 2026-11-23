<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('weighments', function (Blueprint $table) {
            $table->string('gross_source', 40)->nullable()->after('gross_weight');
            $table->timestamp('gross_captured_at')->nullable()->after('gross_source');
            $table->string('device', 120)->nullable()->after('gross_captured_at');
            $table->string('request_id', 120)->nullable()->unique()->after('device');
        });
    }

    public function down(): void
    {
        Schema::table('weighments', fn (Blueprint $table) => $table->dropColumn([
            'gross_source', 'gross_captured_at', 'device', 'request_id',
        ]));
    }
};
