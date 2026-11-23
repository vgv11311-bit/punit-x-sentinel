<?php

use App\Http\Controllers\Api\AuthTokenController;
use App\Http\Controllers\Api\CustomFieldApiController;
use App\Http\Controllers\Api\SettingApiController;
use App\Http\Controllers\Api\WeighmentApiController;
use App\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'name' => 'Sentinel Weighment API',
    'version' => 'v1',
    'authentication' => 'POST /api/v1/auth/token, then send Authorization: Bearer <token>',
    'endpoints' => [
        'POST /api/v1/auth/token',
        'GET /api/v1/me',
        'GET /api/v1/weighments',
        'POST /api/v1/weighments',
        'GET /api/v1/weighments/{id}',
        'PUT /api/v1/weighments/{id}',
        'GET /api/v1/fields',
        'GET /api/v1/fields/{id}',
        'PUT /api/v1/fields/{id}',
        'GET /api/v1/settings',
        'PUT /api/v1/settings',
        'DELETE /api/v1/auth/token',
    ],
]));

Route::prefix('v1')->group(function () {
    Route::post('/auth/token', [AuthTokenController::class, 'store'])->middleware('throttle:10,1');

    Route::middleware(['api.token', 'throttle:120,1'])->group(function () {
        Route::get('/me', [AuthTokenController::class, 'me']);
        Route::post('/auth/verify-password', [AuthTokenController::class, 'verifyPassword'])->middleware('throttle:scale-password');
        Route::delete('/auth/token', [AuthTokenController::class, 'destroy']);
        Route::get('/weighments', [WeighmentApiController::class, 'index']);
        Route::post('/weighments', [WeighmentApiController::class, 'store']);
        Route::get('/weighments/{weighment}', [WeighmentApiController::class, 'show']);
        Route::get('/weighments/{weighment}/inward-report', [ReportController::class, 'inwardPdf']);
        Route::post('/weighments/{weighment}/inward-report', [ReportController::class, 'desktopInwardPdf'])->middleware('throttle:20,1');
        Route::put('/weighments/{weighment}', [WeighmentApiController::class, 'update']);
        Route::get('/fields', [CustomFieldApiController::class, 'index']);
        Route::get('/fields/{field}', [CustomFieldApiController::class, 'show']);
        Route::put('/fields/{field}', [CustomFieldApiController::class, 'update']);
        Route::get('/settings', [SettingApiController::class, 'index']);
        Route::put('/settings', [SettingApiController::class, 'update']);
    });
});
