<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 24)->default('viewer')->after('password');
        });

        Schema::create('custom_fields', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('type', 24);
            $table->json('options')->nullable();
            $table->boolean('is_required')->default(false);
            $table->boolean('is_searchable')->default(false);
            $table->boolean('is_filterable')->default(false);
            $table->boolean('show_in_list')->default(false);
            $table->boolean('show_in_pdf')->default(false);
            $table->boolean('show_in_reports')->default(true);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('weighments', function (Blueprint $table) {
            $table->id();
            $table->string('weighment_no')->unique();
            $table->string('vehicle_plate', 40)->index();
            $table->string('driver_name')->nullable()->index();
            $table->string('material')->nullable()->index();
            $table->decimal('gross_weight', 14, 3)->nullable();
            $table->decimal('tare_weight', 14, 3)->nullable();
            $table->decimal('net_weight', 14, 3)->nullable();
            $table->string('status', 24)->default('gross_pending')->index();
            $table->timestamp('first_weighed_at')->nullable()->index();
            $table->timestamp('completed_at')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('weighment_values', function (Blueprint $table) {
            $table->id();
            $table->foreignId('weighment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('custom_field_id')->constrained()->cascadeOnDelete();
            $table->text('value')->nullable();
            $table->timestamps();
            $table->unique(['weighment_id', 'custom_field_id']);
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('weighment_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 40);
            $table->json('changes')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->timestamps();
        });

        Schema::create('settings', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->text('value')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('settings');
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('weighment_values');
        Schema::dropIfExists('weighments');
        Schema::dropIfExists('custom_fields');
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('role'));
    }
};
