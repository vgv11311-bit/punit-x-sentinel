<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Weighment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SentinelWorkflowTest extends TestCase
{
    public function test_login_page_offers_the_desktop_application_download(): void
    {
        $this->get('/login')
            ->assertOk()
            ->assertSee('Download desktop app')
            ->assertSee('v1.5.4')
            ->assertSee('/downloads/Sentinel-Weighbridge-Setup-1.5.4.exe', false)
            ->assertSee('Sentinel Weighbridge Setup 1.5.4.exe', false);
    }

    use RefreshDatabase;

    public function test_guests_are_redirected_to_login(): void
    {
        $this->get('/')->assertRedirect('/login');
    }

    public function test_operator_can_complete_gross_and_tare_workflow(): void
    {
        $operator = User::factory()->create(['role' => 'operator']);

        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)->postJson('/api/v1/weighments', [
            'vehicle_plate_number' => 'RJ14 AB 1234', 'driver_name' => 'Ravi', 'material' => 'Wheat', 'gross_weight' => 25200,
            'gross_source' => 'Live', 'gross_captured_at' => now()->toIso8601String(), 'request_id' => 'gross-and-tare-test',
        ])->assertCreated();
        $record = Weighment::firstOrFail();
        $this->assertSame('tare_pending', $record->status);
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)
            ->putJson('/api/v1/weighments/'.$record->id, ['tare_weight' => 9200])->assertOk();

        $record->refresh();
        $this->assertSame('completed', $record->status);
        $this->assertEquals(16000, $record->net_weight);
        $this->assertCount(2, $record->audits);
    }

    public function test_desktop_gross_saves_report_core_and_separate_camera_fields(): void
    {
        $operator = User::factory()->create(['role' => 'operator']);
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)
            ->actingAs($operator)->postJson('/api/v1/weighments', [
                'vehicle_plate_number' => 'T578DZE', 'driver_name' => 'Sample Driver', 'material' => 'Copper Ore',
                'gross_weight' => 45340, 'gross_source' => 'Live', 'gross_captured_at' => now()->toIso8601String(),
                'request_id' => 'test-report-cameras',
                'custom_fields' => ['trailer_no' => 'T816EQL', 'container_no' => 'CAIU9720214'],
            ])->assertCreated();

        $record = Weighment::with('values.field')->firstOrFail();
        $this->assertSame('T578DZE', $record->vehicle_plate);
        $this->assertSame('Sample Driver', $record->driver_name);
        $this->assertSame('Copper Ore', $record->material);
        $values = $record->values->mapWithKeys(fn ($value) => [$value->field->slug => $value->value]);
        $this->assertSame('T816EQL', $values['trailer_no']);
        $this->assertSame('CAIU9720214', $values['container_no']);
    }

    private function captureEvidencePayload(): array
    {
        $at = \Carbon\CarbonImmutable::parse('2026-11-13T10:00:00Z')->getTimestamp() * 1000;
        $camera = fn ($id, $value) => ['eventId' => $id, 'value' => $value, 'capturedAt' => $at + 100, 'timestampResolutionMs' => 1, 'clockUncertaintyMs' => 1];
        return [
            'vehicle_plate_number' => 'T578DZE', 'gross_weight' => 45340, 'gross_source' => 'Live',
            'gross_captured_at' => '2026-11-13T10:00:00Z', 'request_id' => 'capture-1',
            'custom_fields' => ['trailer_no' => 'T816EQL', 'container_no' => 'CAIU9720214'],
            'capture_evidence' => ['id' => 'capture-1', 'weightKg' => 45340, 'weightAt' => $at, 'weightUncertaintyMs' => 1, 'maxSkewMs' => 1000,
                'cameras' => ['front' => $camera('front-1', 'T578DZE'), 'rear' => $camera('rear-1', 'T816EQL'), 'container' => $camera('container-1', 'CAIU9720214')]],
        ];
    }

    public function test_reported_capture_evidence_is_saved_in_the_audit_as_unverified(): void
    {
        $operator = User::factory()->create(['role' => 'operator']);
        $payload = $this->captureEvidencePayload();
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)->postJson('/api/v1/weighments', $payload)->assertCreated();
        $changes = Weighment::firstOrFail()->audits()->firstOrFail()->changes;
        $this->assertSame('capture-1', $changes['capture_evidence_unverified']['id']);
        $this->assertSame('container-1', $changes['capture_evidence_unverified']['cameras']['container']['eventId']);
        $this->assertArrayNotHasKey('capture_evidence_verified', $changes);
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)->postJson('/api/v1/weighments', $payload)->assertOk();
        $payload['capture_evidence']['cameras']['front']['eventId'] = 'another-event';
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)->postJson('/api/v1/weighments', $payload)->assertUnprocessable();
        $this->assertDatabaseCount('weighments', 1);
    }

    public function test_capture_evidence_rejects_unrelated_values_late_events_and_image_data(): void
    {
        $operator = User::factory()->create(['role' => 'operator']);
        $base = $this->captureEvidencePayload();
        $badPlate = $base; $badPlate['capture_evidence']['cameras']['rear']['value'] = 'OTHER';
        $late = $base; $late['capture_evidence']['cameras']['container']['capturedAt'] += 1000;
        $image = $base; $image['capture_evidence']['image'] = 'not permitted';
        $duplicate = $base; $duplicate['capture_evidence']['cameras']['rear']['eventId'] = 'front-1';
        foreach ([$badPlate, $late, $image, $duplicate] as $payload) {
            $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)->postJson('/api/v1/weighments', $payload)->assertUnprocessable();
        }
        $this->assertDatabaseCount('weighments', 0);
    }

    public function test_standard_capture_is_audited_and_retry_cannot_change_the_original_data(): void
    {
        $operator = User::factory()->create(['role' => 'operator']);
        $payload = $this->captureEvidencePayload(); unset($payload['capture_evidence']);
        $at = \Carbon\CarbonImmutable::parse($payload['gross_captured_at'])->getTimestamp() * 1000;
        $payload['capture_workflow'] = ['mode'=>'standard','id'=>'capture-1','operatorConfirmed'=>true,'capturedAt'=>$at+100,'weightReceivedAt'=>$at,
            'cameras'=>['front'=>['value'=>'T578DZE','receivedAt'=>$at-2000],'rear'=>['value'=>'T816EQL','receivedAt'=>$at-2000],'container'=>['value'=>'CAIU9720214','receivedAt'=>$at-2000]]];
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)->postJson('/api/v1/weighments',$payload)->assertCreated();
        $audit = Weighment::firstOrFail()->audits()->firstOrFail()->changes;
        $this->assertSame('standard',$audit['capture_workflow_unverified']['mode']);
        $this->get('/weighments/'.Weighment::firstOrFail()->id)->assertOk()->assertSee('Standard capture')->assertSee('timing unverified');
        $this->assertArrayNotHasKey('capture_evidence_verified',$audit);
        $this->postJson('/api/v1/weighments',$payload)->assertOk();
        $changed = $payload; $changed['gross_weight'] = 1;
        $this->postJson('/api/v1/weighments',$changed)->assertUnprocessable();
        $this->assertDatabaseCount('weighments',1);
        $this->assertEquals(45340,Weighment::firstOrFail()->gross_weight);
        $this->putJson('/api/v1/weighments/'.Weighment::firstOrFail()->id,['tare_weight'=>10000])->assertOk();
        $this->assertEquals(35340,Weighment::firstOrFail()->net_weight);
    }

    public function test_standard_capture_rejects_ambiguous_modes_stale_receipts_and_wrong_identifiers(): void
    {
        $operator = User::factory()->create(['role' => 'operator']);
        $base = $this->captureEvidencePayload(); unset($base['capture_evidence']);
        $at = \Carbon\CarbonImmutable::parse($base['gross_captured_at'])->getTimestamp() * 1000;
        $base['capture_workflow'] = ['mode'=>'standard','id'=>'capture-1','operatorConfirmed'=>true,'capturedAt'=>$at+100,'weightReceivedAt'=>$at,
            'cameras'=>['front'=>['value'=>'T578DZE','receivedAt'=>$at],'rear'=>['value'=>'T816EQL','receivedAt'=>$at],'container'=>['value'=>'CAIU9720214','receivedAt'=>$at]]];
        $wrong=$base; $wrong['capture_workflow']['cameras']['rear']['value']='OTHER';
        $stale=$base; $stale['capture_workflow']['cameras']['front']['receivedAt']-=30001;
        $mode=$base; $mode['capture_workflow']['mode']='synchronized';
        $photo=$base; $photo['capture_workflow']['cameras']['front']['image']='image';
        $confirm=$base; $confirm['capture_workflow']['operatorConfirmed']=false;
        foreach ([$wrong,$stale,$mode,$photo,$confirm] as $payload) {
            $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)->postJson('/api/v1/weighments',$payload)->assertUnprocessable();
        }
        $this->assertDatabaseCount('weighments',0);
    }

    public function test_gross_accepts_the_live_required_custom_field_slugs(): void
    {
        foreach (['driver' => 'Driver', 'quality_check' => 'Vehicle Plate Number', 'company' => 'Company'] as $slug => $name) {
            \App\Models\CustomField::updateOrCreate(['slug' => $slug], ['name' => $name, 'type' => 'text', 'is_required' => true, 'is_active' => true]);
        }
        $operator = User::factory()->create(['role' => 'operator']);
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)
            ->actingAs($operator)->postJson('/api/v1/weighments', [
                'vehicle_plate_number' => 'T578DZE', 'driver_name' => 'Driver', 'material' => 'Copper Ore',
                'gross_weight' => 45340, 'gross_source' => 'Live', 'gross_captured_at' => now()->toIso8601String(),
                'request_id' => 'live-required-slugs', 'custom_fields' => [
                    'driver' => 'Driver', 'quality_check' => 'T578DZE', 'company' => 'Example',
                    'trailer_no' => 'T816EQL', 'container_no' => 'CAIU9720214',
                ],
            ])->assertCreated();
        $values = Weighment::firstOrFail()->values()->with('field')->get()->mapWithKeys(fn ($value) => [$value->field->slug => $value->value]);
        $this->assertSame('Driver', $values['driver']);
        $this->assertSame('T578DZE', $values['quality_check']);
        $this->assertSame('Example', $values['company']);
    }

    public function test_website_cannot_manually_edit_device_captured_weighment(): void
    {
        $operator = User::factory()->create(['role' => 'operator']);
        $record = Weighment::create(['weighment_no' => 'WB-DEVICE-1', 'vehicle_plate' => 'T578DZE', 'gross_weight' => 45340, 'gross_source' => 'Live', 'status' => 'tare_pending', 'first_weighed_at' => now()]);
        $this->actingAs($operator)->get('/weighments/'.$record->id)->assertOk()->assertDontSee('Capture tare');
        $this->actingAs($operator)->get('/weighments/'.$record->id.'/edit')->assertForbidden();
        $this->actingAs($operator)->put('/weighments/'.$record->id, ['vehicle_plate' => 'EDITED', 'gross_weight' => 1])->assertForbidden();
        $this->assertSame('T578DZE', $record->fresh()->vehicle_plate);
        $this->assertEquals(45340, $record->fresh()->gross_weight);
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)
            ->putJson('/api/v1/weighments/'.$record->id, ['vehicle_plate_number' => 'EDITED', 'gross_weight' => 1])
            ->assertUnprocessable()->assertJsonValidationErrors(['vehicle_plate', 'gross_weight']);
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateApiToken::class)->actingAs($operator)
            ->putJson('/api/v1/weighments/'.$record->id, ['tare_weight' => 10000])->assertOk();
        $this->assertSame('completed', $record->fresh()->status);
    }

    public function test_tare_cannot_exceed_gross(): void
    {
        $operator = User::factory()->create(['role' => 'operator']);
        $record = Weighment::create(['weighment_no'=>'WB-LEGACY', 'vehicle_plate'=>'RJ14 ZZ 9999', 'gross_weight'=>100, 'status'=>'tare_pending', 'first_weighed_at'=>now()]);
        $this->actingAs($operator)->put('/weighments/'.$record->id, [
            'vehicle_plate' => 'RJ14 ZZ 9999', 'gross_weight' => 100, 'tare_weight' => 101,
        ])->assertSessionHasErrors('tare_weight');
        $this->assertNull($record->fresh()->tare_weight);
    }

    public function test_website_does_not_allow_new_manual_weighments(): void
    {
        $operator = User::factory()->create(['role' => 'operator']);
        $this->actingAs($operator)->get('/weighments/create')->assertForbidden();
        $this->actingAs($operator)->post('/weighments', ['vehicle_plate' => 'T123ABC', 'gross_weight' => 100])->assertForbidden();
        $this->assertDatabaseCount('weighments', 0);
    }

    public function test_viewer_cannot_change_weighments_or_fields(): void
    {
        $viewer = User::factory()->create(['role' => 'viewer']);
        $this->actingAs($viewer)->get('/weighments/create')->assertForbidden();
        $this->actingAs($viewer)->get('/fields')->assertForbidden();
    }

    public function test_administrator_can_open_dynamic_fields(): void
    {
        $administrator = User::factory()->create(['role' => 'administrator']);

        $this->actingAs($administrator)
            ->get('/fields')
            ->assertOk()
            ->assertSee('Dynamic fields');
    }

    public function test_progress_dashboard_uses_weight_colours_without_gross_pending_control(): void
    {
        $administrator = User::factory()->create(['role' => 'administrator']);

        $this->actingAs($administrator)
            ->get('/')
            ->assertOk()
            ->assertDontSee('Gross pending')
            ->assertSee('weight-gross', false)
            ->assertSee('weight-tare', false)
            ->assertSee('weight-net', false);
    }

    public function test_pdf_headers_always_use_sentinel_branding(): void
    {
        $administrator = User::factory()->create(['role' => 'administrator']);
        $record = Weighment::create([
            'weighment_no' => 'WB-TEST-1',
            'vehicle_plate' => 'RJ14 AB 1234',
            'gross_weight' => 1000,
            'status' => 'tare_pending',
            'first_weighed_at' => now(),
            'created_by' => $administrator->id,
            'updated_by' => $administrator->id,
        ])->load(['values.field', 'creator']);

        $slip = view('pdf.slip', [
            'weighment' => $record,
            'company' => 'Lilaram Food Products',
            'unit' => 'kg',
            'footer' => '',
        ])->render();
        $report = view('pdf.report', [
            'records' => collect(),
            'columns' => ['weighment_no' => 'Weighment No.'],
            'meta' => ['title' => 'Weighment Report', 'from' => null, 'to' => null, 'status' => null, 'vehicle' => null, 'driver' => null, 'material' => null, 'include_totals' => false],
            'company' => 'Lilaram Food Products',
            'unit' => 'kg',
        ])->render();

        $this->assertStringContainsString('<h1>SENTINEL</h1>', $slip);
        $this->assertStringContainsString('<h1>SENTINEL · Weighment Report</h1>', $report);
        $this->assertStringNotContainsString('Lilaram Food Products', $slip.$report);
    }
}
