<?php

namespace App\Support;

use Illuminate\Http\Request;

class ReportAccess
{
    public static function confirmed(Request $request): bool
    {
        if (! $request->hasSession() || ! $request->user()) return false;
        $token = (string) ($request->header('X-Report-Window') ?: ($request->isMethod('POST') ? $request->input('_report_window_token', '') : ''));
        if (strlen($token) !== 64) return false;
        $grant = $request->session()->get('reports_windows', [])[hash('sha256', $token)] ?? [];
        return ($grant['user_id'] ?? null) === $request->user()->id
            && hash_equals(hash('sha256', $request->user()->getAuthPassword()), (string) ($grant['password_stamp'] ?? ''));
    }

    public static function denyUnlessConfirmed(Request $request)
    {
        if (self::confirmed($request)) return null;
        return $request->expectsJson()
            ? response()->json(['message' => 'Confirm your password on the website to access reports.'], 403)
            : redirect()->route('reports.index', $request->route('weighment') ? ['download' => $request->route('weighment')->id] : [])->withErrors(['password' => 'Enter your password to open reports.']);
    }
}
