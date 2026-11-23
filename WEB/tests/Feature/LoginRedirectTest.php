<?php
namespace Tests\Feature;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;
class LoginRedirectTest extends TestCase
{
    use RefreshDatabase;
    public function test_customer_login_does_not_follow_a_super_admin_intended_url(): void
    {
        $user=User::factory()->create(['role'=>'administrator','password'=>Hash::make('customer-password')]);
        $this->get('/super/customers')->assertRedirect('/login');
        $this->post('/login',['email'=>$user->email,'password'=>'customer-password'])->assertRedirect('/');
        $this->get('/')->assertOk();
        $this->get('/super/customers')->assertForbidden();
    }
}
