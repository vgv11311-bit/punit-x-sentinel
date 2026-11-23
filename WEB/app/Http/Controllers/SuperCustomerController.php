<?php
namespace App\Http\Controllers;
use App\Models\Customer;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class SuperCustomerController extends Controller
{
    public function index() { return view('super-customers', ['customers'=>Customer::with('users')->orderBy('name')->get()]); }
    public function changePassword(Request $request)
    {
        $data=$request->validate(['current_password'=>['required','string','max:1024'],'new_password'=>['required','string','min:12','max:1024','confirmed']]);
        if (! Hash::check($data['current_password'],$request->user()->getAuthPassword())) return back()->withErrors(['current_password'=>'The current password is incorrect.']);
        $request->user()->forceFill(['password'=>$data['new_password'],'remember_token'=>Str::random(60)])->save();
        $request->session()->regenerate();
        return back()->with('success','Super administrator password changed.');
    }
    public function store(Request $request)
    {
        $data=$request->validate(['name'=>['required','string','max:120'],'admin_name'=>['required','string','max:120'],'email'=>['required','email','max:255',Rule::unique('users','email')],'password'=>['required','string','min:12','max:1024'],'expires_on'=>['required','date','after_or_equal:today']]);
        DB::transaction(function () use ($data) {
            $customer=Customer::create(['name'=>$data['name'],'enabled'=>true,'expires_on'=>$data['expires_on']]);
            User::create(['name'=>$data['admin_name'],'email'=>$data['email'],'password'=>$data['password'],'role'=>'administrator','customer_id'=>$customer->id]);
            $fields=['gate'=>'Gate','trailer_no'=>'Trailer No','container_no'=>'Container No','container_type'=>'Container Type','container_size'=>'Container Size','driver_licence'=>"Driver's Licence",'product_count_desc'=>'Product Count-Desc','customer_client_name'=>'Customer/Client Name','agent_name'=>'Agent Name','transporter'=>'Transporter','cargo_type'=>'Cargo-TYPE'];
            foreach ($fields as $slug=>$name) DB::table('custom_fields')->insert(['customer_id'=>$customer->id,'slug'=>$slug,'name'=>$name,'type'=>'text','is_active'=>true,'is_required'=>true,'show_in_reports'=>true,'show_in_pdf'=>true,'sort_order'=>100,'created_at'=>now(),'updated_at'=>now()]);
            foreach (['company_name'=>$customer->name,'weight_unit'=>'kg','slip_footer'=>'Computer-generated weighment slip'] as $key=>$value) DB::table('customer_settings')->insert(['customer_id'=>$customer->id,'key'=>$key,'value'=>$value,'created_at'=>now(),'updated_at'=>now()]);
        });
        return redirect()->route('super.customers.index')->with('success','Customer and administrator created.');
    }
    public function update(Request $request, Customer $customer)
    {
        $data=$request->validate(['name'=>['required','string','max:120'],'expires_on'=>['nullable','date'],'enabled'=>['required','boolean']]);
        DB::transaction(function () use ($customer,$data) { $customer->update($data); if (! $customer->isAvailable()) $customer->users()->update(['api_token_hash'=>null,'api_token_created_at'=>null]); });
        return redirect()->route('super.customers.index')->with('success','Customer access updated.');
    }
    public function addAdmin(Request $request, Customer $customer)
    {
        $data=$request->validate(['name'=>['required','string','max:120'],'email'=>['required','email','max:255',Rule::unique('users','email')],'password'=>['required','string','min:12','max:1024']]);
        $customer->users()->create($data+['role'=>'administrator']);
        return redirect()->route('super.customers.index')->with('success','Administrator created.');
    }
    public function renameAdmin(Request $request, Customer $customer, User $user)
    {
        abort_unless((int) $user->customer_id === (int) $customer->id && ! $user->isSuperAdmin(),404);
        $data=$request->validate(['name'=>['required','string','max:120']]);
        $user->update($data);
        return redirect()->route('super.customers.index')->with('success','Administrator name updated.');
    }
}
