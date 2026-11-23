<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Operations') · Sentinel</title>
    <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="bg-slate-950 text-slate-100 antialiased">
<div class="app-shell">
    <aside class="sidebar" id="sidebar">
        <a href="{{ route('dashboard') }}" class="brand">
            <span class="brand-mark"><span></span></span>
            <span><strong>SENTINEL</strong><small>WEIGHMENT CONTROL</small></span>
        </a>
        <nav class="nav-stack">
            @if(auth()->user()->isSuperAdmin())
            <a class="nav-link active" href="{{ route('super.customers.index') }}"><span>◇</span> Customer access</a>
            @else
            <a class="nav-link {{ request()->routeIs('dashboard') ? 'active' : '' }}" href="{{ route('dashboard') }}"><span>◫</span> Weighment Progress</a>
            <a class="nav-link {{ request()->routeIs('completed.*') ? 'active' : '' }}" href="{{ route('completed.index') }}"><span>✓</span> Completed Records</a>
            <a class="nav-link {{ request()->routeIs('reports.*') ? 'active' : '' }}" href="{{ route('reports.index') }}"><span>⌁</span> Report studio</a>
            @if(auth()->user()->isAdmin())
                <div class="nav-label">Administration</div>
                <a class="nav-link {{ request()->routeIs('fields.*') ? 'active' : '' }}" href="{{ route('fields.index') }}"><span>◇</span> Dynamic fields</a>
            @endif
            @endif
        </nav>
        <div class="sidebar-foot">
            <div class="user-card"><span class="avatar">{{ strtoupper(substr(auth()->user()->name, 0, 1)) }}</span><span><strong>{{ auth()->user()->name }}</strong><small>{{ ucfirst(auth()->user()->role) }}</small></span></div>
            <form method="POST" action="{{ route('logout') }}">@csrf<button class="quiet-button" type="submit">Sign out</button></form>
        </div>
    </aside>
    <main class="main-panel">
        <header class="topbar">
            <button class="mobile-menu" data-menu aria-label="Open menu">☰</button>
            <div><span class="system-dot"></span> System online</div>
            <div class="top-time" data-clock></div>
        </header>
        <div class="page-wrap reveal">
            @if(session('success'))<div class="flash success">✓ {{ session('success') }}</div>@endif
            @if($errors->any())<div class="flash error"><strong>Please check the form.</strong><ul>@foreach($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div>@endif
            @yield('content')
        </div>
    </main>
</div>
<script data-report-session data-user="{{ auth()->id() }}" data-reports-url="{{ route('reports.index') }}">{!! file_get_contents(resource_path('js/report-access.js')) !!}</script>
@stack('scripts')
</body>
</html>
