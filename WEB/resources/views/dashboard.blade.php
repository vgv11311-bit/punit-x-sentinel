@extends('layouts.app')
@section('title', 'Weighment Progress')
@section('content')
<div class="page-heading"><div><span class="eyebrow">Command center</span><h1>Weighment Progress</h1><p>Monitor the queue, find vehicles, and review pending loads at the gate.</p></div></div>
<div class="stat-grid two">
    <a href="{{ route('dashboard', ['status'=>'tare_pending']) }}" class="stat-card green"><div class="stat-icon">T</div><div><span>Tare queue</span><strong data-count="{{ $counts['tare_pending'] }}">0</strong><small>Vehicles due to return</small></div><i>→</i></a>
    <a href="{{ route('completed.index') }}" class="stat-card blue"><div class="stat-icon">✓</div><div><span>Completed</span><strong data-count="{{ $counts['completed'] }}">0</strong><small>Closed weighments</small></div><i>→</i></a>
</div>
<section class="panel">
    <div class="panel-head"><div><h2>Records</h2><p>{{ $records->total() }} matching weighments</p></div><button class="button secondary" data-filter-toggle>Filters <span>⌄</span></button></div>
    <form method="GET" class="filter-bar {{ request()->hasAny(['status','from','to','driver','material']) ? 'open' : '' }}" data-filters>
        <label class="search-wide"><span>⌕</span><input name="search" value="{{ request('search') }}" placeholder="Search plate, weighment no., driver or material"></label>
        <div class="filter-drawer">
            <select name="status"><option value="">All statuses</option><option value="tare_pending" @selected(request('status')==='tare_pending')>Tare pending</option><option value="completed" @selected(request('status')==='completed')>Completed</option></select>
            <input type="date" name="from" value="{{ request('from') }}" title="From date"><input type="date" name="to" value="{{ request('to') }}" title="To date">
            <input name="driver" value="{{ request('driver') }}" placeholder="Driver"><input name="material" value="{{ request('material') }}" placeholder="Material">
            @foreach($filterFields as $field)<input name="field_{{ $field->id }}" value="{{ request('field_'.$field->id) }}" placeholder="{{ $field->name }}">@endforeach
            <button class="button primary" type="submit">Apply filters</button><a class="button ghost" href="{{ route('dashboard') }}">Clear all</a>
        </div>
    </form>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Weighment</th><th>Vehicle</th><th>Date & time</th><th>Driver / Material</th><th class="weight-gross">Gross</th><th class="weight-tare">Tare</th><th class="weight-net">Net</th>@foreach($listFields as $field)<th>{{ $field->name }}</th>@endforeach<th>Status</th><th></th></tr></thead>
        <tbody>@forelse($records as $record)<tr>
            <td><strong>{{ $record->weighment_no }}</strong></td><td><span class="plate">{{ $record->vehicle_plate }}</span></td><td>{{ optional($record->first_weighed_at)->format('d M Y') }}<small>{{ optional($record->first_weighed_at)->format('h:i A') }}</small></td>
            <td>{{ $record->driver_name ?: '—' }}<small>{{ $record->material ?: 'No material' }}</small></td><td class="weight-gross">{{ number_format($record->gross_weight, 3) }} <small>{{ $unit }}</small></td><td class="weight-tare">{{ $record->tare_weight ? number_format($record->tare_weight, 3) : 'Pending' }}</td><td class="weight-net"><strong>{{ $record->net_weight ? number_format($record->net_weight, 3) : '—' }}</strong></td>
            @foreach($listFields as $field)<td>{{ $record->customValue($field->id) ?: '—' }}</td>@endforeach
            <td><span class="status {{ $record->status }}">{{ str_replace('_', ' ', $record->status) }}</span></td><td><a class="icon-link" href="{{ route('weighments.show', $record) }}">→</a></td>
        </tr>@empty<tr><td colspan="20" class="empty-state"><strong>No records found</strong><span>Adjust the filters to review available records.</span></td></tr>@endforelse</tbody></table></div>
    <div class="pagination">{{ $records->links() }}</div>
</section>
@endsection
