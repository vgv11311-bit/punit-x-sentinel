<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind('db.connector.mysql', fn () => new \App\Support\RetryingMySqlConnector());
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('scale-password', fn (Request $request) =>
            Limit::perMinute(5)->by('scale-password:'.hash('sha256', $request->bearerToken() ?: $request->ip()))
        );
    }
}
