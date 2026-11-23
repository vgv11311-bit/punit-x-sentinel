<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('sentinel:create-super-admin {email}', function (string $email) {
    $password = $this->secret('New super-admin password (at least 8 characters)');
    if (!filter_var($email,FILTER_VALIDATE_EMAIL) || strlen($password ?? '') < 8) { $this->error('Valid email and password of at least 8 characters required.'); return 1; }
    if (\App\Models\User::where('email',$email)->exists()) { $this->error('This email is already in use.'); return 1; }
    \App\Models\User::create(['name'=>'Super Administrator','email'=>$email,'password'=>$password,'role'=>'super_admin','customer_id'=>null]);
    $this->info('Super administrator created.');
})->purpose('Create a super administrator without saving the password in source code');
