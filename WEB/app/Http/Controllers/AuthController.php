<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AuthController extends Controller
{
    public function show() { return view('auth.login'); }

    public function login(Request $request)
    {
        $credentials = $request->validate(['email' => ['required', 'email'], 'password' => ['required']]);
        if (! Auth::attempt($credentials, $request->boolean('remember'))) {
            return back()->withErrors(['email' => 'The email or password is incorrect.'])->onlyInput('email');
        }
        if (! $request->user()->accountAvailable()) { Auth::logout(); return back()->withErrors(['email'=>'Account is disabled or expired.'])->onlyInput('email'); }
        $request->session()->regenerate();
        if ($request->user()->isSuperAdmin()) return redirect()->route('super.customers.index');
        // A previously visited super-admin URL must not redirect a customer to a forbidden page.
        $request->session()->forget('url.intended');
        return redirect()->route('dashboard');
    }

    public function logout(Request $request)
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        return redirect()->route('login');
    }
}
