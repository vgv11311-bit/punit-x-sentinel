@extends('layouts.app')
@section('title', 'Completed Records')
@section('content')
<div class="page-heading"><div><span class="eyebrow">Completed weighments</span><h1>Completed Records</h1><p>Gross, tare and net weights from completed entries. Download the inward cargo report for any record.</p></div><a class="button secondary" href="{{ route('reports.index') }}">Open Report studio →</a></div>
<section class="panel">
    <div class="panel-head"><div><h2>Completed records</h2><p>{{ $records->total() }} matching entries · Last report login: {{ session('reports_last_login') ? \Carbon\Carbon::parse(session('reports_last_login'))->format('d M Y, h:i A') : 'Not yet unlocked' }}</p></div></div>
    <form method="GET" class="filter-bar open" style="display:flex;gap:12px;flex-wrap:wrap;padding:20px">
        <input name="search" value="{{ request('search') }}" placeholder="Search plate, driver, material or container" aria-label="Search completed records" style="flex:1;min-width:230px">
        <input type="date" name="from" value="{{ request('from') }}" aria-label="Completed from date">
        <input type="date" name="to" value="{{ request('to') }}" aria-label="Completed to date">
        <button class="button primary" type="submit">Search</button><a class="button secondary" href="{{ route('completed.index') }}">Clear</a>
    </form>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Weighment</th><th>Vehicle</th><th>Driver / Material</th><th>Completed</th><th class="weight-gross">Gross</th><th class="weight-tare">Tare</th><th class="weight-net">Net</th><th>Report</th></tr></thead><tbody>
    @forelse($records as $record)<tr>
        <td><a href="{{ route('weighments.show', $record) }}"><strong>{{ $record->weighment_no }}</strong></a><small class="status completed">Completed</small></td>
        <td><span class="plate">{{ $record->vehicle_plate }}</span></td>
        <td>{{ $record->driver_name ?: '—' }}<small>{{ $record->material ?: '—' }}</small></td>
        <td>{{ optional($record->completed_at)->format('d M Y, h:i A') ?: '—' }}</td>
        <td class="weight-gross">{{ number_format($record->gross_weight, 3) }} <small>{{ $unit }}</small></td>
        <td class="weight-tare">{{ $record->tare_weight !== null ? number_format($record->tare_weight, 3) : '—' }} <small>{{ $unit }}</small></td>
        <td class="weight-net"><strong>{{ $record->net_weight !== null ? number_format($record->net_weight, 3) : '—' }}</strong> <small>{{ $unit }}</small></td>
        <td><form method="POST" action="{{ route('weighments.pdf', $record) }}" data-report-download>@csrf<button class="button primary" type="submit">↓ Download report</button></form></td>
    </tr>@empty<tr><td colspan="8" class="empty-state"><strong>No completed records found</strong><span>Completed gross and tare entries will appear here.</span></td></tr>@endforelse
    </tbody></table></div><div class="pagination">{{ $records->links() }}</div>
</section>
@endsection
