<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AuthTokenController extends Controller
{
    public function store(Request $request)
    {
        $credentials = $request->validate(['email' => ['required', 'email'], 'password' => ['required', 'string']]);
        $user = User::where('email', $credentials['email'])->first();

        if (! $user || ! Hash::check($credentials['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => 'The supplied credentials are invalid.']);
        }

        if (! $user->accountAvailable() || $user->isSuperAdmin()) return response()->json(['message'=>'Account is disabled or expired.'],403);

        $token = Str::random(80);
        $user->forceFill(['api_token_hash' => hash('sha256', $token), 'api_token_created_at' => now()])->save();

        return response()->json(['data' => [
            'token' => $token,
            'token_type' => 'Bearer',
            'user' => $this->userData($user),
        ]], 201);
    }

    public function me(Request $request)
    {
        return response()->json(['data' => $this->userData($request->user())]);
    }

    public function verifyPassword(Request $request)
    {
        $data = $request->validate(['password' => ['required', 'string']]);
        if (! Hash::check($data['password'], $request->user()->password)) {
            throw ValidationException::withMessages(['password' => 'The password is incorrect.']);
        }
        return response()->json(['verified' => true]);
    }

    public function destroy(Request $request)
    {
        $request->user()->forceFill(['api_token_hash' => null, 'api_token_created_at' => null])->save();
        return response()->json(['message' => 'API token revoked.']);
    }

    private function userData(User $user): array
    {
        return $user->only(['id', 'name', 'email', 'role']);
    }
}
