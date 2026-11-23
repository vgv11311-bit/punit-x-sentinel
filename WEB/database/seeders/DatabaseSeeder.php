<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\CustomField;
use App\Models\Setting;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $adminEmail = env('SENTINEL_ADMIN_EMAIL', 'sentinel@gmail.com');
        $admin = ['name' => 'Sentinel Administrator', 'role' => 'administrator'];
        $adminPassword = env('SENTINEL_ADMIN_PASSWORD_HASH') ?: env('SENTINEL_ADMIN_PASSWORD');
        if (! $adminPassword && app()->environment('production')) {
            throw new \RuntimeException('Set SENTINEL_ADMIN_PASSWORD or SENTINEL_ADMIN_PASSWORD_HASH before seeding production.');
        }
        $admin['password'] = $adminPassword ?: 'Sentinel@123';
        User::updateOrCreate(['email' => $adminEmail], $admin);
        User::where('email', 'admin@sentinel.local')->where('email', '!=', $adminEmail)->delete();
        if (app()->environment(['local', 'testing'])) {
            User::updateOrCreate(['email' => 'operator@sentinel.local'], [
                'name' => 'Weighbridge Operator', 'password' => 'Operator@123', 'role' => 'operator',
            ]);
            User::updateOrCreate(['email' => 'viewer@sentinel.local'], [
                'name' => 'Management Viewer', 'password' => 'Viewer@123', 'role' => 'viewer',
            ]);
        }

        foreach ([
            'company_name' => 'Lilaram Food Products',
            'weight_unit' => 'kg',
            'slip_footer' => 'Computer-generated weighment slip',
        ] as $key => $value) Setting::updateOrCreate(['key' => $key], ['value' => $value]);

        CustomField::updateOrCreate(['slug' => 'supplier'], [
            'name' => 'Supplier', 'type' => 'text', 'is_searchable' => true,
            'is_filterable' => true, 'show_in_list' => true, 'show_in_pdf' => true,
            'show_in_reports' => true, 'is_active' => true, 'sort_order' => 10,
        ]);
        CustomField::updateOrCreate(['slug' => 'quality_check'], [
            'name' => 'Quality Check Completed', 'type' => 'checkbox',
            'show_in_pdf' => true, 'show_in_reports' => true, 'is_active' => true, 'sort_order' => 20,
        ]);
    }
}
