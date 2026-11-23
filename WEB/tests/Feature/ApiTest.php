<?php

namespace Tests\Feature;

use App\Models\CustomField;
use App\Models\Setting;
use App\Models\User;
use App\Models\Weighment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_regular_polling_does_not_exhaust_password_attempts(): void
    {
        $user = User::factory()->create(['password' => 'correct-secret']);
        $token = $this->postJson('/api/v1/auth/token', ['email' => $user->email, 'password' => 'correct-secret'])->json('data.token');
        for ($i = 0; $i < 10; $i++) {
            $this->withToken($token)->getJson('/api/v1/fields')->assertOk();
        }
        $this->withToken($token)->postJson('/api/v1/auth/verify-password', ['password' => 'correct-secret'])->assertOk();
        for ($i = 0; $i < 4; $i++) {
            $this->withToken($token)->postJson('/api/v1/auth/verify-password', ['password' => 'incorrect'])->assertUnprocessable();
        }
        $this->withToken($token)->postJson('/api/v1/auth/verify-password', ['password' => 'incorrect'])->assertStatus(429);
    }

    public function test_password_verification_requires_auth_and_preserves_the_existing_token(): void
    {
        $user = User::factory()->create(['password' => 'correct-secret']);
        $token = $this->postJson('/api/v1/auth/token', ['email' => $user->email, 'password' => 'correct-secret'])->json('data.token');
        $this->postJson('/api/v1/auth/verify-password', ['password' => 'correct-secret'])->assertUnauthorized();
        $this->withToken($token)->postJson('/api/v1/auth/verify-password', ['password' => 'incorrect'])->assertUnprocessable();
        $this->withToken($token)->postJson('/api/v1/auth/verify-password', ['password' => 'correct-secret'])->assertOk()->assertJsonPath('verified', true);
        $this->withToken($token)->getJson('/api/v1/me')->assertOk();
    }

    public function test_api_requires_a_bearer_token(): void
    {
        $this->getJson('/api/v1/weighments')
            ->assertUnauthorized()
            ->assertJsonPath('message', 'Unauthenticated. Supply a valid Bearer token.');
    }

    public function test_user_can_create_a_token_and_read_api_data(): void
    {
        $user = User::factory()->create([
            'email' => 'api@example.com',
            'password' => 'secret123',
            'role' => 'viewer',
        ]);

        $token = $this->postJson('/api/v1/auth/token', [
            'email' => $user->email,
            'password' => 'secret123',
        ])->assertCreated()->json('data.token');

        $this->withToken($token)->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.email', 'api@example.com')
            ->assertJsonPath('data.role', 'viewer');

        $this->withToken($token)->getJson('/api/v1/weighments')
            ->assertOk()
            ->assertJsonStructure(['data', 'meta' => ['current_page', 'last_page', 'per_page', 'total']]);

        $this->withToken($token)->getJson('/api/v1/weighments?status=unknown')
            ->assertUnprocessable();
    }

    public function test_administrator_can_update_weighment_fields_and_settings(): void
    {
        $admin = User::factory()->create(['password' => 'secret123', 'role' => 'administrator']);
        $token = $this->postJson('/api/v1/auth/token', [
            'email' => $admin->email,
            'password' => 'secret123',
        ])->json('data.token');

        $field = CustomField::create([
            'name' => 'Supplier',
            'slug' => 'supplier',
            'type' => 'text',
            'is_active' => true,
            'sort_order' => 10,
            'created_by' => $admin->id,
        ]);
        $record = Weighment::create([
            'weighment_no' => 'WM-API-1',
            'vehicle_plate' => 'RJ14 AB 1234',
            'gross_weight' => 25000,
            'status' => 'tare_pending',
            'first_weighed_at' => now(),
            'created_by' => $admin->id,
            'updated_by' => $admin->id,
        ]);

        $this->withToken($token)->putJson('/api/v1/weighments/'.$record->id, [
            'vehicle_plate' => 'RJ14 AB 1234',
            'driver_name' => 'Ravi',
            'material' => 'Wheat',
            'gross_weight' => 25000,
            'tare_weight' => 9000,
            'notes' => 'API update',
            'custom' => ['supplier' => 'Test Supplier'],
        ])->assertOk()
            ->assertJsonPath('data.net_weight', 16000)
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.custom.supplier', 'Test Supplier');

        $this->assertDatabaseHas('audit_logs', ['weighment_id' => $record->id, 'action' => 'completed']);

        $this->withToken($token)->putJson('/api/v1/fields/'.$field->id, [
            'name' => 'Supplier Name',
            'type' => 'text',
            'options' => null,
            'sort_order' => 20,
            'is_required' => false,
            'is_searchable' => true,
            'is_filterable' => true,
            'show_in_list' => true,
            'show_in_pdf' => true,
            'show_in_reports' => true,
            'is_active' => true,
        ])->assertOk()->assertJsonPath('data.name', 'Supplier Name');

        $this->withToken($token)->putJson('/api/v1/settings', [
            'company_name' => 'Sentinel Test',
            'weight_unit' => 'kg',
            'slip_footer' => 'Generated by API',
        ])->assertOk()->assertJsonPath('data.company_name', 'Sentinel Test');

        $this->assertSame('Sentinel Test', Setting::valueFor('company_name'));
    }

    public function test_desktop_can_create_gross_once_and_save_tare_by_web_id(): void
    {
        $operator = User::factory()->create([
            'email' => 'desktop@example.com',
            'password' => 'secret123',
            'role' => 'operator',
        ]);
        $token = $this->postJson('/api/v1/auth/token', [
            'email' => $operator->email,
            'password' => 'secret123',
        ])->json('data.token');

        $payload = [
            'vehicle_plate_number' => 'RJ14 AB 1234',
            'gross_weight' => 28000,
            'gross_source' => 'Live',
            'gross_captured_at' => '2026-11-05T15:44:00+05:30',
            'device' => 'COM3',
            'request_id' => 'GROSS-UNIQUE-ID',
            'status' => 'tare_pending',
            'custom_fields' => [],
        ];

        $created = $this->withToken($token)->postJson('/api/v1/weighments', $payload)
            ->assertCreated()
            ->assertJsonPath('data.status', 'tare_pending');
        $webId = $created->json('data.id');

        $this->withToken($token)->postJson('/api/v1/weighments', $payload)
            ->assertOk()
            ->assertJsonPath('data.id', $webId);
        $this->assertDatabaseCount('weighments', 1);
        $this->assertDatabaseHas('weighments', [
            'id' => $webId,
            'vehicle_plate' => 'RJ14 AB 1234',
            'gross_source' => 'Live',
            'device' => 'COM3',
            'request_id' => 'GROSS-UNIQUE-ID',
        ]);

        $this->withToken($token)->putJson('/api/v1/weighments/'.$webId, [
            'tare_weight' => 10000,
        ])->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.net_weight', 18000);
    }
}
