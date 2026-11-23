<?php
namespace Tests\Feature;
use App\Models\User;
use App\Models\Weighment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ReportWindowTest extends TestCase
{
    use RefreshDatabase;
    private function operator(): User { return User::factory()->create(['role'=>'operator','password'=>Hash::make('report-test-password')]); }
    private function unlock(): string { return $this->postJson('/reports/unlock',['password'=>'report-test-password'])->assertOk()->json('token'); }

    public function test_reports_require_a_password_and_the_current_tab_secret(): void
    {
        $this->actingAs($this->operator());
        $this->get('/reports')->assertSee('Confirm your password')->assertDontSee('report-grid',false);
        $this->post('/reports/pdf',['columns'=>['vehicle_plate']])->assertRedirect('/reports');
        $this->postJson('/reports/unlock',['password'=>'wrong'])->assertUnprocessable();
        $token=$this->unlock();
        $this->get('/reports')->assertSee('Confirm your password');
        $this->get('/reports?_report_window_token='.$token)->assertSee('Confirm your password');
        $this->withHeader('X-Report-Window',$token)->get('/reports')->assertSee('report-grid',false)->assertSee('Last report login:')->assertDontSee('15 minutes');
        $this->withHeader('X-Report-Window',str_repeat('x',64))->postJson('/reports/pdf',['columns'=>['vehicle_plate']])->assertForbidden();
    }

    public function test_same_tab_keeps_access_after_fifteen_minutes_and_after_navigation(): void
    {
        $this->actingAs($this->operator());$token=$this->unlock();
        $this->withHeader('X-Report-Window',$token)->get('/reports')->assertSee('report-grid',false);
        $this->get('/completed')->assertOk();
        $this->travel(24)->hours();
        $this->get('/reports')->assertSee('report-grid',false);
        $this->post('/reports/pdf',['columns'=>['vehicle_plate']])->assertOk()->assertHeader('content-type','application/pdf');
        $this->travelBack();$this->flushHeaders();
        $this->post('/reports/pdf',['columns'=>['vehicle_plate']])->assertRedirect('/reports');
        $this->post('/reports/pdf',['columns'=>['vehicle_plate'],'_report_window_token'=>$token])->assertOk();
        $this->post('/reports/lock',['_report_window_token'=>$token])->assertNoContent();
        $this->withHeader('X-Report-Window',$token)->postJson('/reports/pdf',['columns'=>['vehicle_plate']])->assertForbidden();
    }

    public function test_user_password_changes_and_logout_revoke_access(): void
    {
        $first=$this->operator();$second=$this->operator();$this->actingAs($first);$token=$this->unlock();
        $this->actingAs($second)->withHeader('X-Report-Window',$token)->postJson('/reports/pdf',['columns'=>['vehicle_plate']])->assertForbidden();
        $first->update(['password'=>Hash::make('changed')]);
        $this->actingAs($first->fresh())->postJson('/reports/pdf',['columns'=>['vehicle_plate']])->assertForbidden();
        $this->actingAs($second);$this->flushHeaders();$token=$this->unlock();$this->post('/logout');
        $this->actingAs($second)->withHeader('X-Report-Window',$token)->postJson('/reports/pdf',['columns'=>['vehicle_plate']])->assertForbidden();
    }

    public function test_completed_page_filters_completed_entries_and_downloads_the_reference_report(): void
    {
        $this->actingAs($this->operator());
        $record=Weighment::create(['weighment_no'=>'WB-DONE','vehicle_plate'=>'TRUCK-DONE','driver_name'=>'Sample Driver','material'=>'COPPER ORE','gross_weight'=>45340,'tare_weight'=>10000,'net_weight'=>35340,'status'=>'completed','first_weighed_at'=>now()->subHour(),'completed_at'=>now()]);
        Weighment::create(['weighment_no'=>'WB-PENDING','vehicle_plate'=>'TRUCK-PENDING','gross_weight'=>100,'status'=>'tare_pending','first_weighed_at'=>now()]);
        $this->get('/completed')->assertOk()->assertSee('WB-DONE')->assertDontSee('WB-PENDING')->assertSee('45,340.000')->assertSee('10,000.000')->assertSee('35,340.000')->assertSee('Download report');
        $this->get('/completed?search=nonexistent')->assertDontSee('WB-DONE');
        $this->post('/weighments/'.$record->id.'/pdf')->assertRedirect('/reports?download='.$record->id);
        $token=$this->unlock();
        $this->post('/weighments/'.$record->id.'/pdf',['_report_window_token'=>$token])->assertOk()->assertDownload('Inward-Cargo-'.$record->id.'.pdf');
        $this->get('/completed?from=wrong')->assertSessionHasErrors('from');
    }

    public function test_wrong_password_attempts_are_rate_limited(): void
    {
        $this->actingAs($this->operator());
        for($i=0;$i<5;$i++)$this->postJson('/reports/unlock',['password'=>'wrong'])->assertUnprocessable();
        $this->postJson('/reports/unlock',['password'=>'wrong'])->assertStatus(429);
    }
}
