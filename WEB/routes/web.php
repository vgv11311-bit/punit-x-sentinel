<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\CustomFieldController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\SettingController;
use App\Http\Controllers\WeighmentController;
use App\Http\Controllers\SuperCustomerController;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'show'])->name('login');
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1')->name('login.attempt');
});

Route::middleware(['auth','account.available'])->group(function () {
    Route::middleware('role:super_admin')->prefix('super')->name('super.')->group(function () {
        Route::get('/customers',[SuperCustomerController::class,'index'])->name('customers.index');
        Route::post('/password',[SuperCustomerController::class,'changePassword'])->middleware('throttle:5,1')->name('password');
        Route::post('/customers',[SuperCustomerController::class,'store'])->name('customers.store');
        Route::put('/customers/{customer}',[SuperCustomerController::class,'update'])->name('customers.update');
        Route::post('/customers/{customer}/admins',[SuperCustomerController::class,'addAdmin'])->name('customers.admins');
        Route::patch('/customers/{customer}/admins/{user}',[SuperCustomerController::class,'renameAdmin'])->name('customers.admins.rename');
    });
    Route::post('/logout', [AuthController::class, 'logout'])->name('logout');
    Route::get('/', [DashboardController::class, 'index'])->name('dashboard');
    Route::get('/completed', [DashboardController::class, 'completed'])->name('completed.index');
    Route::get('/reports', [ReportController::class, 'index'])->name('reports.index');
    Route::post('/reports/unlock', [ReportController::class, 'unlock'])->middleware('throttle:5,1')->name('reports.unlock');
    Route::post('/reports/lock', [ReportController::class, 'lock'])->name('reports.lock');
    Route::post('/reports/preview', [ReportController::class, 'preview'])->name('reports.preview');
    Route::post('/reports/pdf', [ReportController::class, 'pdf'])->name('reports.pdf');

    Route::middleware('role:administrator,operator')->group(function () {
        Route::get('/weighments/create', [WeighmentController::class, 'create'])->name('weighments.create');
        Route::post('/weighments', [WeighmentController::class, 'store'])->name('weighments.store');
        Route::get('/weighments/{weighment}/edit', [WeighmentController::class, 'edit'])->name('weighments.edit');
        Route::put('/weighments/{weighment}', [WeighmentController::class, 'update'])->name('weighments.update');
    });

    Route::get('/weighments/{weighment}', [WeighmentController::class, 'show'])->name('weighments.show');
    Route::match(['GET', 'POST'], '/weighments/{weighment}/pdf', [WeighmentController::class, 'pdf'])->name('weighments.pdf');

    Route::middleware('role:administrator')->group(function () {
        Route::resource('fields', CustomFieldController::class)->except(['show', 'create']);
        Route::get('/settings', [SettingController::class, 'edit'])->name('settings.edit');
        Route::put('/settings', [SettingController::class, 'update'])->name('settings.update');
    });
});
