<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'role' => \App\Http\Middleware\RequireRole::class,
            'api.token' => \App\Http\Middleware\AuthenticateApiToken::class,
            'account.available' => \App\Http\Middleware\EnsureAccountAvailable::class,
        ]);
        $middleware->prependToPriorityList(\Illuminate\Routing\Middleware\SubstituteBindings::class, \App\Http\Middleware\AuthenticateApiToken::class);
        $middleware->prependToPriorityList(\Illuminate\Routing\Middleware\SubstituteBindings::class, \App\Http\Middleware\EnsureAccountAvailable::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
