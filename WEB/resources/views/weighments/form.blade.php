@extends('layouts.app')
@section('title', $weighment->exists ? 'Update Weighment' : 'New Weighment')
@section('content')
<div class="page-heading"><div><a class="back-link" href="{{ $weighment->exists ? route('weighments.show',$weighment) : route('dashboard') }}">← Back</a><span class="eyebrow">{{ $weighment->exists ? $weighment->weighment_no : 'Gate entry' }}</span><h1>{{ $weighment->exists ? ($weighment->status === 'tare_pending' ? 'Capture tare weight' : 'Update weighment') : 'Start a new weighment' }}</h1><p>Enter the vehicle and load details. Net weight is calculated automatically.</p></div></div>
<form method="POST" action="{{ $weighment->exists ? route('weighments.update',$weighment) : route('weighments.store') }}" class="form-layout">@csrf @if($weighment->exists)@method('PUT')@endif
    <section class="panel form-card"><div class="section-title"><span>01</span><div><h2>Vehicle information</h2><p>Identity and load context</p></div></div><div class="field-grid">
        <label>Vehicle plate number <b>*</b><input name="vehicle_plate" value="{{ old('vehicle_plate',$weighment->vehicle_plate) }}" required placeholder="e.g. RJ14 AB 1234" class="uppercase"></label>
        <label>Driver name<input name="driver_name" value="{{ old('driver_name',$weighment->driver_name) }}" placeholder="Driver's full name"></label>
        <label>Material<input name="material" value="{{ old('material',$weighment->material) }}" placeholder="e.g. Wheat, rice, packaging"></label>
        @foreach($fields as $field)<label>{{ $field->name }} @if($field->is_required)<b>*</b>@endif
            @php($value=old('custom.'.$field->id,$weighment->exists ? $weighment->customValue($field->id) : null))
            @if($field->type==='dropdown')<select name="custom[{{ $field->id }}]" @required($field->is_required)><option value="">Choose an option</option>@foreach($field->options ?? [] as $option)<option value="{{ $option }}" @selected($value===$option)>{{ $option }}</option>@endforeach</select>
            @elseif($field->type==='checkbox')<span class="toggle-row"><input type="checkbox" name="custom[{{ $field->id }}]" value="1" @checked($value)><span>Yes, completed</span></span>
            @else<input name="custom[{{ $field->id }}]" type="{{ $field->type==='datetime'?'datetime-local':$field->type }}" value="{{ $value }}" @required($field->is_required)>@endif
        </label>@endforeach
    </div></section>
    <section class="panel form-card weight-card"><div class="section-title"><span>02</span><div><h2>Weight capture</h2><p>Positive values only · {{ $unit }}</p></div></div><div class="weight-grid">
        <label><span>Gross weight <b>*</b></span><div class="weight-input"><input name="gross_weight" type="number" min="0.001" step="0.001" value="{{ old('gross_weight',$weighment->gross_weight) }}" required data-gross><em>{{ $unit }}</em></div></label>
        <span class="math-symbol">−</span><label><span>Tare weight</span><div class="weight-input"><input name="tare_weight" type="number" min="0.001" step="0.001" value="{{ old('tare_weight',$weighment->tare_weight) }}" data-tare><em>{{ $unit }}</em></div></label>
        <span class="math-symbol">=</span><div class="net-preview"><span>Net weight</span><strong data-net>{{ $weighment->net_weight ? number_format($weighment->net_weight,3) : '—' }}</strong><em>{{ $unit }}</em></div>
    </div><p class="microcopy">Leave tare blank for the first weighing. Add it when the vehicle returns to complete the record.</p></section>
    <section class="panel form-card"><div class="section-title"><span>03</span><div><h2>Operator notes</h2><p>Optional context for the audit trail</p></div></div><label>Notes<textarea name="notes" rows="4" placeholder="Seal number, gate observations, or other remarks">{{ old('notes',$weighment->notes) }}</textarea></label></section>
    <div class="form-actions"><a class="button ghost" href="{{ route('dashboard') }}">Cancel</a><button class="button primary large" type="submit">{{ $weighment->exists ? 'Save weighment' : 'Capture gross weight' }} <span>→</span></button></div>
</form>
@endsection
