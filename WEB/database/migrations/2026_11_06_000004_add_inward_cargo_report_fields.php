<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('custom_fields')) return;
        $fields = [
            'gate' => 'Gate', 'trailer_no' => 'Trailer No', 'container_no' => 'Container No',
            'container_type' => 'Container Type', 'container_size' => 'Container Size',
            'driver_licence' => "Driver's Licence", 'product_count_desc' => 'Product Count-Desc',
            'customer_client_name' => 'Customer/Client Name', 'agent_name' => 'Agent Name',
            'transporter' => 'Transporter', 'cargo_type' => 'Cargo-TYPE',
        ];
        $order = 100;
        foreach ($fields as $slug => $name) {
            if (! DB::table('custom_fields')->where('slug', $slug)->orWhere('name', $name)->exists()) {
                DB::table('custom_fields')->insert([
                    'slug' => $slug, 'name' => $name, 'type' => 'text', 'is_required' => false,
                    'show_in_reports' => true, 'show_in_pdf' => true, 'is_active' => true,
                    'sort_order' => $order, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
            $order += 10;
        }
    }

    // Do not remove fields or user-entered data when rolling back.
    public function down(): void {}
};
