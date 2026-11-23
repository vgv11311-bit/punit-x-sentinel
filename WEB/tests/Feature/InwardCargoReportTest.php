<?php
namespace Tests\Feature;

use App\Models\CustomField;
use App\Models\User;
use App\Models\Weighment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InwardCargoReportTest extends TestCase
{
    use RefreshDatabase;

    public function test_desktop_download_requires_api_token_and_password_each_time(): void
    {
        $user=User::factory()->create(['password'=>\Illuminate\Support\Facades\Hash::make('report-password'),'api_token_hash'=>hash('sha256','desktop-token')]);
        $record=Weighment::create(['weighment_no'=>'WB-DESKTOP','vehicle_plate'=>'TRUCK','gross_weight'=>100,'status'=>'completed','first_weighed_at'=>now()]);
        $url='/api/v1/weighments/'.$record->id.'/inward-report';
        $this->postJson($url,['password'=>'report-password'])->assertUnauthorized();
        $this->withToken('desktop-token')->postJson($url,['password'=>'wrong'])->assertUnprocessable();
        $this->postJson($url,[])->assertUnprocessable();
        $this->postJson($url,['password'=>'report-password'])->assertOk()->assertHeader('content-type','application/pdf')->assertDownload('Inward-Cargo-'.$record->id.'.pdf');
        $this->postJson($url,[])->assertUnprocessable();
        $record->update(['status'=>'tare_pending']);
        $this->postJson($url,['password'=>'report-password'])->assertUnprocessable();
    }

    private function reportCells(Weighment $record): array
    {
        $html = view('pdf.inward-cargo', ['records' => collect([$record->load('values.field')]), 'unit' => 'kg'])->render();
        $document = new \DOMDocument();
        @$document->loadHTML('<?xml encoding="UTF-8">'.$html);
        $xpath = new \DOMXPath($document);
        $cells = [];
        foreach ($xpath->query('//table[@class="fields"]/tr') as $row) {
            $td = $row->getElementsByTagName('td');
            for ($i = 0; $i < 4; $i += 2) $cells[trim($td[$i]->textContent)] = trim(ltrim(trim($td[$i + 1]->textContent), ':'));
        }
        return $cells;
    }

    public function test_all_reference_fields_are_taken_from_the_saved_entry(): void
    {
        $record = Weighment::create(['weighment_no'=>'WB-AUTO','vehicle_plate'=>'T578DZE','driver_name'=>'MIKIDADI MCHOMBA','material'=>'COPPER ORE','gross_weight'=>45340,'status'=>'completed','first_weighed_at'=>'2026-11-03 11:40:00']);
        $values = ['gate'=>'IN','trailer_no'=>'T816EQL','container_no'=>'CAIU9720214','container_type'=>'45G1','container_size'=>'40 FT','driver_licence'=>'4000521898','product_count_desc'=>'17 - BAG','customer_client_name'=>'HEROCEAN','agent_name'=>'DONITO CLEARING & FORWARDING CO. LTD','transporter'=>'ALLY ALLY','cargo_type'=>'Containerised-Cargo'];
        foreach ($values as $slug=>$value) {
            $field=CustomField::where('slug',$slug)->firstOrFail();
            $record->values()->create(['custom_field_id'=>$field->id,'value'=>$value]);
        }
        $this->assertSame([
            'TIME IN'=>'2026-11-03 11:40','Gate'=>'IN','Vehicle No'=>'T578DZE','Weight In'=>'45340 Kg',
            'Trailer No'=>'T816EQL','Product'=>'COPPER ORE','Container No'=>'CAIU9720214','Product Count-Desc'=>'17 - BAG',
            'Container Type'=>'45G1','Customer/Client Name'=>'HEROCEAN','Container Size'=>'40 FT','Agent Name'=>'DONITO CLEARING & FORWARDING CO. LTD',
            "Driver's Name"=>'MIKIDADI MCHOMBA','Transporter'=>'ALLY ALLY',"Driver's Licence"=>'4000521898','Cargo-TYPE'=>'Containerised-Cargo',
        ], $this->reportCells($record));
        // A completed-entry download needs only authorization, never report-field input.
        $user=User::factory()->create(['password'=>\Illuminate\Support\Facades\Hash::make('report-password')]);
        $token=$this->actingAs($user)->postJson('/reports/unlock',['password'=>'report-password'])->assertOk()->json('token');
        $this->post('/weighments/'.$record->id.'/pdf',['_report_window_token'=>$token])->assertOk()->assertDownload('Inward-Cargo-'.$record->id.'.pdf');
    }

    public function test_missing_fields_use_na_and_zero_and_legacy_values_are_preserved(): void
    {
        $record = new Weighment(['vehicle_plate'=>'  ','driver_name'=>null,'material'=>'','gross_weight'=>null]);
        $record->setRelation('values', collect());
        $html=view('pdf.inward-cargo',['records'=>collect([$record]),'unit'=>'kg'])->render();
        $this->assertSame(16,substr_count($html,': N/A</td>'));
        $this->assertStringNotContainsString('—',$html);
        $record=Weighment::create(['weighment_no'=>'WB-ZERO','vehicle_plate'=>'ZERO','gross_weight'=>0,'status'=>'tare_pending']);
        $record->values()->create(['custom_field_id'=>CustomField::where('slug','container_no')->firstOrFail()->id,'value'=>'  ']);
        foreach (['container_number'=>['Container Number','CAIU9720214'],'product_count'=>['Product count','0'],'product_desc'=>['Product description','BAG']] as $slug=>[$name,$value]) {
            $field=CustomField::create(['slug'=>$slug,'name'=>$name,'type'=>'text']);
            $record->values()->create(['custom_field_id'=>$field->id,'value'=>$value]);
        }
        $cells=$this->reportCells($record);
        $this->assertSame('CAIU9720214',$cells['Container No']);
        $this->assertSame('0 - BAG',$cells['Product Count-Desc']);
        $this->assertSame('0 Kg',$cells['Weight In']);
        $this->assertSame('N/A',$cells["Driver's Name"]);
        $countField=CustomField::where('slug','product_count')->firstOrFail();
        $this->assertSame('0',trim(view('reports.partials.value',['record'=>$record,'key'=>'custom_'.$countField->id])->render()));
        $this->assertSame('N/A',trim(view('reports.partials.value',['record'=>$record,'key'=>'driver_name'])->render()));
    }

    public function test_default_fields_and_inward_cargo_pdf(): void
    {
        $this->assertDatabaseHas('custom_fields', ['slug' => 'container_no', 'is_active' => true]);
        $user = User::factory()->create(['role' => 'operator', 'password' => \Illuminate\Support\Facades\Hash::make('test-report-password')]);
        $record = Weighment::create(['weighment_no' => 'WB-TEST-001', 'vehicle_plate' => 'T123ABC', 'driver_name' => 'Sample Driver', 'material' => 'Copper Ore', 'gross_weight' => 45340, 'status' => 'tare_pending', 'first_weighed_at' => now()]);
        $field = CustomField::where('slug', 'container_no')->firstOrFail();
        $field->update(['slug' => 'legacy_container']);
        $record->values()->create(['custom_field_id' => $field->id, 'value' => 'TEST123']);
        $token = $this->actingAs($user)->postJson('/reports/unlock', ['password' => 'test-report-password'])->assertOk()->json('token');
        $this->withHeader('X-Report-Window', $token)->get('/reports')->assertOk()->assertSee('report-grid', false);
        $this->actingAs($user)->post('/reports/preview', ['format' => 'inward', 'columns' => ['vehicle_plate']])
            ->assertOk()->assertSee('Inward cargo report preview')->assertSee('TEST123');
        $this->actingAs($user)->post('/reports/pdf', ['format' => 'inward', 'columns' => ['vehicle_plate']])->assertOk()->assertHeader('content-type', 'application/pdf');
        $html = view('pdf.inward-cargo', ['records' => collect([$record->load('values.field')]), 'unit' => 'kg'])->render();
        $this->assertStringContainsString('TEST123', $html);
        $this->assertStringContainsString('45340 Kg', $html);
        $this->assertStringContainsString("Surveyor's Report", $html);
        $order = ['TIME IN', 'Vehicle No', 'Trailer No', 'Container No', 'Container Type', 'Container Size', "Driver's Name", "Driver's Licence", "Surveyor's Report"];
        $plainHtml = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $positions = array_map(fn ($label) => strpos($plainHtml, $label), $order);
        $this->assertNotContains(false, $positions);
        $sorted = $positions; sort($sorted);
        $this->assertSame($sorted, $positions, 'Report fields must retain the reference order.');
    }

    public function test_desktop_report_is_denied_even_with_a_valid_api_token(): void
    {
        $user = User::factory()->create(['role' => 'operator', 'api_token_hash' => hash('sha256', 'report-test-token')]);
        $record = Weighment::create(['weighment_no' => 'WB-TEST-002', 'vehicle_plate' => 'T123ABC', 'gross_weight' => 12345, 'status' => 'tare_pending', 'first_weighed_at' => now()]);
        $this->getJson('/api/v1/weighments/'.$record->id.'/inward-report')->assertUnauthorized();
        $response = $this->withToken('report-test-token')->get('/api/v1/weighments/'.$record->id.'/inward-report');
        $response->assertForbidden();
        $this->assertStringNotContainsString('%PDF-', $response->getContent());
    }
}
