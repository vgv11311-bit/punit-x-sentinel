<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id(); $table->string('name'); $table->boolean('enabled')->default(true); $table->boolean('legacy_report_brand')->default(false);
            $table->date('expires_on')->nullable(); $table->timestamps();
        });
        $legacy = DB::table('customers')->insertGetId(['name'=>'Existing customer','enabled'=>true,'legacy_report_brand'=>true,'created_at'=>now(),'updated_at'=>now()]);
        foreach (['users','custom_fields','weighments'] as $name) {
            Schema::table($name, function (Blueprint $table) { $table->unsignedBigInteger('customer_id')->nullable()->index(); });
            DB::table($name)->update(['customer_id'=>$legacy]);
        }
        Schema::table('custom_fields', function (Blueprint $table) { $table->dropUnique(['slug']); $table->unique(['customer_id','slug']); });
        Schema::table('weighments', function (Blueprint $table) {
            $table->dropUnique(['weighment_no']); $table->dropUnique(['request_id']);
            $table->unique(['customer_id','weighment_no']); $table->unique(['customer_id','request_id']);
        });
        Schema::create('customer_settings', function (Blueprint $table) {
            $table->id(); $table->unsignedBigInteger('customer_id')->index(); $table->string('key');
            $table->text('value')->nullable(); $table->timestamps(); $table->unique(['customer_id','key']);
        });
        foreach (DB::table('settings')->get() as $setting) DB::table('customer_settings')->insert(['customer_id'=>$legacy,'key'=>$setting->key,'value'=>$setting->value,'created_at'=>now(),'updated_at'=>now()]);
    }
    public function down(): void { throw new RuntimeException('Customer isolation cannot be rolled back without a verified data migration.'); }
};
