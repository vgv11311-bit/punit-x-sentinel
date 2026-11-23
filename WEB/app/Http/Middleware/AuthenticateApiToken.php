<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        $user = $token ? User::where('api_token_hash', hash('sha256', $token))->first() : null;

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated. Supply a valid Bearer token.'], 401);
        }

        if (! $user->accountAvailable() || $user->isSuperAdmin()) return response()->json(['message'=>'Account is disabled or expired.'],401);

        Auth::setUser($user);
        $request->setUserResolver(fn () => $user);

        return $next($request);
    }
}
