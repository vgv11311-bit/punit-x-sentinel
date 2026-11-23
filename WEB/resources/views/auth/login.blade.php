<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · Sentinel</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">@vite(['resources/css/app.css', 'resources/js/app.js'])</head>
<body class="login-page"><div class="login-ambient one"></div><div class="login-ambient two"></div>
@php
    $installerPath = base_path('downloads/Sentinel-Weighbridge-Setup-1.5.11.exe');
    $installerPublishedAt = is_file($installerPath)
        ? \Carbon\Carbon::createFromTimestamp(filemtime($installerPath))->timezone('Asia/Kolkata')
        : null;
    $installerSize = is_file($installerPath)
        ? number_format(filesize($installerPath) / 1048576, 1).' MB'
        : 'Windows';
@endphp
<main class="login-shell">
    <section class="login-card">
        <div class="brand login-card-brand"><span class="brand-mark"><span></span></span><span><strong>SENTINEL</strong><small>WEIGHMENT CONTROL</small></span></div>
        <div><span class="eyebrow">Secure access</span><h2>Welcome back</h2><p>Sign in to continue to the weighbridge console.</p></div>
        @if($errors->any())<div class="flash error">{{ $errors->first() }}</div>@endif
        <form method="POST" action="{{ route('login.attempt') }}" class="form-stack">@csrf
            <label>Email address<input name="email" type="email" value="{{ old('email') }}" required autofocus placeholder="sentinel@gmail.com"></label>
            <label>Password<input name="password" type="password" required placeholder="Enter your password"></label>
            <label class="check-line"><input type="checkbox" name="remember" value="1"><span>Keep me signed in</span></label>
            <button class="button primary full" type="submit">Enter Sentinel <span>→</span></button>
        </form>
        <a class="desktop-download" href="{{ url('/downloads/Sentinel-Weighbridge-Setup-1.5.11.exe') }}" download="Sentinel Weighbridge Setup 1.5.11.exe" aria-label="Download Sentinel Weighbridge version 1.5.11 installer for Windows">
            <span class="desktop-download-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="img"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/></svg>
            </span>
            <span class="desktop-download-copy">
                <strong>Download desktop app <span class="download-version">v1.5.11</span></strong>
                <small>{{ $installerSize }} · @if($installerPublishedAt)Updated {{ $installerPublishedAt->format('d M Y, h:i A') }}@else Latest Windows release @endif</small>
            </span>
            <span class="desktop-download-type">EXE</span>
        </a>
        <p class="security-note">Protected by encrypted sessions and role-based access.</p>
    </section>
</main></body></html>
