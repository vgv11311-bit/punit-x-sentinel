<?php
namespace Tests\Feature;
use App\Models\Customer;
use App\Models\CustomField;
use App\Models\User;
use App\Models\Weighment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class CustomerIsolationTest extends TestCase
{
    use RefreshDatabase;
    private function customer(string $name): Customer { return Customer::create(['name'=>$name,'enabled'=>true,'expires_on'=>now()->addYear()]); }
    private function user(Customer $c, string $email): User { return User::factory()->create(['customer_id'=>$c->id,'email'=>$email,'role'=>'administrator','password'=>Hash::make('customer-password'),'api_token_hash'=>hash('sha256',$email)]); }
    public function test_customers_cannot_view_or_download_each_others_records_or_edit_fields(): void
    {
        $a=$this->customer('A');$b=$this->customer('B');$ua=$this->user($a,'a@example.test');$ub=$this->user($b,'b@example.test');
        $this->actingAs($ua);$ra=Weighment::create(['weighment_no'=>'A-123','vehicle_plate'=>'A-TRUCK','gross_weight'=>100,'status'=>'completed','first_weighed_at'=>now()]);
        $fa=CustomField::create(['name'=>'Private A','slug'=>'private_a','type'=>'text']);
        $this->actingAs($ub);$rb=Weighment::create(['weighment_no'=>'B-123','vehicle_plate'=>'B-TRUCK','gross_weight'=>100,'status'=>'completed','first_weighed_at'=>now()]);
        $this->get('/')->assertOk()->assertSee('B-TRUCK')->assertDontSee('A-TRUCK');
        $this->get('/weighments/'.$ra->id)->assertNotFound();
        $this->post('/weighments/'.$ra->id.'/pdf')->assertNotFound();
        $this->get('/fields/'.$fa->id.'/edit')->assertNotFound();
        $this->withToken('b@example.test')->getJson('/api/v1/weighments/'.$ra->id)->assertNotFound();
        $this->withToken('b@example.test')->postJson('/api/v1/weighments/'.$ra->id.'/inward-report',['password'=>'customer-password'])->assertNotFound();
        $this->getJson('/api/v1/fields/'.$fa->id)->assertNotFound();
        $this->getJson('/api/v1/weighments')->assertOk()->assertJsonFragment(['vehicle_plate'=>'B-TRUCK'])->assertJsonMissing(['vehicle_plate'=>'A-TRUCK']);
        $report=view('pdf.inward-cargo',['records'=>collect([$rb->load('values.field')]),'unit'=>'kg'])->render();
        $this->assertStringContainsString('B</strong>',$report);
        $this->assertStringNotContainsString('DONITO INVESTMENT',$report);
        \Illuminate\Support\Facades\Auth::logout();
        $this->withToken('b@example.test')->getJson('/api/v1/weighments/'.$ra->id)->assertNotFound();
        $this->withToken('b@example.test')->getJson('/api/v1/fields/'.$fa->id)->assertNotFound();
    }
    public function test_expiry_and_disable_block_existing_web_sessions_and_api_tokens(): void
    {
        $c=$this->customer('Test');$u=$this->user($c,'test@example.test');
        $this->actingAs($u)->get('/')->assertOk();
        $c->update(['enabled'=>false]);$this->get('/')->assertRedirect('/login');
        $this->withToken('test@example.test')->getJson('/api/v1/me')->assertUnauthorized();
        $this->postJson('/api/v1/auth/token',['email'=>$u->email,'password'=>'customer-password'])->assertForbidden();
        $c->update(['enabled'=>true,'expires_on'=>now()->subDay()]);
        $this->withToken('test@example.test')->getJson('/api/v1/me')->assertUnauthorized();
        $this->post('/login',['email'=>$u->email,'password'=>'customer-password'])->assertSessionHasErrors('email');
        $c->update(['expires_on'=>now()->toDateString()]);
        $this->assertTrue($c->fresh()->isAvailable(),'Access remains active through the end of its expiry date.');
    }
    public function test_super_admin_manages_customers_and_normal_admin_cannot(): void
    {
        $c=$this->customer('Existing');$normal=$this->user($c,'normal@example.test');
        $super=User::factory()->create(['customer_id'=>null,'role'=>'super_admin']);
        $this->actingAs($normal)->get('/super/customers')->assertForbidden();
        $this->actingAs($super)->get('/super/customers')->assertOk()->assertSee('Existing');
        $this->get('/')->assertRedirect('/super/customers');
        $this->post('/super/customers',['name'=>'New client','admin_name'=>'Client admin','email'=>'client@example.test','password'=>'safe-test-password','expires_on'=>now()->addYear()->toDateString()])->assertRedirect('/super/customers');
        $client=Customer::where('name','New client')->firstOrFail();
        $this->assertDatabaseHas('users',['email'=>'client@example.test','customer_id'=>$client->id,'role'=>'administrator']);
        $admin=User::where('email','client@example.test')->firstOrFail();
        $this->patch('/super/customers/'.$client->id.'/admins/'.$admin->id,['name'=>'Renamed Admin'])->assertRedirect();
        $this->assertSame('Renamed Admin',$admin->fresh()->name);
        $this->patch('/super/customers/'.$client->id.'/admins/'.$normal->id,['name'=>'Wrong customer'])->assertNotFound();
        $this->assertDatabaseHas('custom_fields',['customer_id'=>$client->id,'slug'=>'container_no']);
        $this->put('/super/customers/'.$client->id,['name'=>'New client','expires_on'=>now()->addYear()->toDateString(),'enabled'=>0])->assertRedirect();
        $this->assertFalse($client->fresh()->enabled);
    }

    public function test_settings_fields_and_search_are_scoped_for_each_customer(): void
    {
        $a=$this->customer('A');$b=$this->customer('B');$ua=$this->user($a,'a@example.test');$ub=$this->user($b,'b@example.test');
        $this->actingAs($ua);
        \App\Models\CustomerSetting::create(['key'=>'company_name','value'=>'A Company']);
        CustomField::create(['name'=>'A Field','slug'=>'same_slug','type'=>'text']);
        $this->actingAs($ub);
        \App\Models\CustomerSetting::create(['key'=>'company_name','value'=>'B Company']);
        CustomField::create(['name'=>'B Field','slug'=>'same_slug','type'=>'text']);
        $this->get('/fields')->assertSee('B Field')->assertDontSee('A Field');
        $this->withToken('b@example.test')->getJson('/api/v1/settings')->assertJsonPath('data.company_name','B Company');
        $this->getJson('/api/v1/fields')->assertJsonFragment(['name'=>'B Field'])->assertJsonMissing(['name'=>'A Field']);
        $this->actingAs($ua)->flushHeaders()->get('/fields')->assertSee('A Field')->assertDontSee('B Field');
        $this->withToken('a@example.test')->getJson('/api/v1/settings')->assertJsonPath('data.company_name','A Company');
    }

    public function test_super_admin_can_change_password_only_after_confirming_current_password(): void
    {
        $super=User::factory()->create(['customer_id'=>null,'role'=>'super_admin','password'=>Hash::make('current-password')]);
        $this->actingAs($super)->from('/super/customers')->post('/super/password',['current_password'=>'wrong','new_password'=>'replacement-password','new_password_confirmation'=>'replacement-password'])->assertSessionHasErrors('current_password');
        $this->assertTrue(Hash::check('current-password',$super->fresh()->password));
        $this->post('/super/password',['current_password'=>'current-password','new_password'=>'replacement-password','new_password_confirmation'=>'replacement-password'])->assertRedirect('/super/customers');
        $this->assertTrue(Hash::check('replacement-password',$super->fresh()->password));
    }
}
