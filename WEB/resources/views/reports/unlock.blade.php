@extends('layouts.app')
@section('title', 'Unlock reports')
@section('content')
<div class="page-heading"><div><span class="eyebrow">Protected reports</span><h1>Unlock Report studio</h1><p>Reports are available only on this website.</p></div></div>
<section class="panel form-card" style="max-width:520px">
    <h2>Confirm your password</h2>
    <p>Enter the password for your signed-in Sentinel account. Report access stays unlocked in this browser tab. Closing or reloading the tab locks reports. A new tab or window requires your password again.</p>
    @error('password')<div class="flash error" role="alert">{{ $message }}</div>@enderror
    <p>Last report login: <strong>{{ session('reports_last_login') ? \Carbon\Carbon::parse(session('reports_last_login'))->format('d M Y, h:i A') : 'Not yet unlocked' }}</strong></p>
    <p id="report-unlock-error" role="alert"></p>
    <noscript>Enable JavaScript to unlock reports for this browser tab.</noscript>
    <form data-report-unlock method="POST" action="{{ route('reports.unlock') }}" class="form-stack">@csrf
        <label for="report-password">Account password</label>
        <input id="report-password" name="password" type="password" autocomplete="current-password" required autofocus>
        <button class="button primary" type="submit">Unlock reports</button>
        <a class="button secondary" href="{{ route('dashboard') }}">Back to operations</a>
    </form>
</section>
@endsection
