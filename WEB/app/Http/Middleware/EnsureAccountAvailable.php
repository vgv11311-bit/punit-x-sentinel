<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
class EnsureAccountAvailable
{
    public function handle(Request $request, Closure $next)
    {
        if (! $request->user() || ! $request->user()->accountAvailable()) {
            if ($request->expectsJson()) return response()->json(['message'=>'Account is disabled or expired.'],403);
            Auth::logout(); $request->session()->invalidate(); $request->session()->regenerateToken();
            return redirect()->route('login')->withErrors(['email'=>'Account is disabled or expired.']);
        }
        return $next($request);
    }
}
