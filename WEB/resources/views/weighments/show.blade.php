@extends('layouts.app')
@section('title', $weighment->weighment_no)
@section('content')
<div class="page-heading"><div><a class="back-link" href="{{ route('dashboard') }}">← Back to operations</a><span class="eyebrow">Record details</span><h1>{{ $weighment->weighment_no }}</h1><p>Created {{ optional($weighment->first_weighed_at)->format('d M Y, h:i A') }} · {{ $weighment->vehicle_plate }}</p></div><div class="action-cluster"><form method="POST" action="{{ route('weighments.pdf',$weighment) }}" data-report-download>@csrf<button class="button secondary" type="submit">↓ Download report</button></form>@if(auth()->user()->canOperate() && strcasecmp((string) $weighment->gross_source, 'Live') !== 0)<a class="button primary" href="{{ route('weighments.edit',$weighment) }}">{{ $weighment->status==='tare_pending'?'Capture tare':'Edit record' }} →</a>@endif</div></div>
<div class="detail-hero {{ $weighment->status }}"><div><span class="status {{ $weighment->status }}">{{ str_replace('_',' ',$weighment->status) }}</span><h2>{{ $weighment->vehicle_plate }}</h2><p>{{ $weighment->driver_name ?: 'Driver not specified' }} · {{ $weighment->material ?: 'Material not specified' }}</p></div><div class="weight-summary"><div><span>Gross</span><strong>{{ number_format($weighment->gross_weight,3) }}</strong><em>{{ $unit }}</em></div><i>−</i><div><span>Tare</span><strong>{{ $weighment->tare_weight ? number_format($weighment->tare_weight,3) : '—' }}</strong><em>{{ $unit }}</em></div><i>=</i><div class="net"><span>Net</span><strong>{{ $weighment->net_weight ? number_format($weighment->net_weight,3) : '—' }}</strong><em>{{ $unit }}</em></div></div></div>
@php
    $captureAudit = $weighment->audits->firstWhere('action', 'created');
    $standardCapture = $captureAudit?->changes['capture_workflow_unverified'] ?? null;
@endphp
@if($standardCapture)
<div class="panel" style="padding:16px;margin-bottom:20px"><strong>Standard capture · timing unverified</strong><p>Operator confirmed the truck identifiers. Device values were frozen for saving. This record does not certify one-second synchronization.</p></div>
@endif
<div class="two-column">
<section class="panel form-card"><div class="panel-head"><div><h2>Record information</h2><p>Standard and configured values</p></div></div><dl class="detail-list"><div><dt>Date and time</dt><dd>{{ optional($weighment->first_weighed_at)->format('d M Y, h:i A') }}</dd></div><div><dt>Driver name</dt><dd>{{ $weighment->driver_name ?: '—' }}</dd></div><div><dt>Material</dt><dd>{{ $weighment->material ?: '—' }}</dd></div>@foreach($weighment->values as $value)<div><dt>{{ $value->field?->name }}</dt><dd>{{ $value->field?->type==='checkbox' ? ($value->value?'Yes':'No') : ($value->value ?: '—') }}</dd></div>@endforeach<div><dt>Notes</dt><dd>{{ $weighment->notes ?: '—' }}</dd></div></dl></section>
<section class="panel form-card"><div class="panel-head"><div><h2>Audit history</h2><p>Who changed what and when</p></div></div><div class="timeline">@foreach($weighment->audits as $audit)<div class="timeline-item"><span></span><div><strong>{{ ucfirst($audit->action) }}</strong><p>{{ $audit->user?->name ?? 'System' }} · {{ $audit->created_at->format('d M Y, h:i A') }}</p></div></div>@endforeach</div></section>
</div>
@endsection
