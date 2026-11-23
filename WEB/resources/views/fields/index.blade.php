@extends('layouts.app')
@section('title','Dynamic Fields')
@section('content')
<div class="page-heading"><div><span class="eyebrow">Flexible configuration</span><h1>Dynamic fields</h1><p>Add operational data points without changing code. Historical values remain intact when fields are disabled.</p></div><button class="button primary" data-modal-open="field-modal">＋ Add field</button></div>
<section class="panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Search / filter</th><th>Visible in</th><th>Status</th><th></th></tr></thead><tbody>@foreach($fields as $field)<tr><td><strong>{{ $field->name }}</strong><small>{{ $field->slug }}</small></td><td>{{ ucfirst($field->type) }}</td><td>{{ $field->is_required?'Yes':'Optional' }}</td><td>{{ collect([$field->is_searchable ? 'Search' : null, $field->is_filterable ? 'Filter' : null])->filter()->implode(' / ') ?: '—' }}</td><td>{{ collect(['List'=>$field->show_in_list,'PDF'=>$field->show_in_pdf,'Reports'=>$field->show_in_reports])->filter()->keys()->implode(', ') ?: 'Form only' }}</td><td><span class="status {{ $field->is_active?'completed':'gross_pending' }}">{{ $field->is_active?'Active':'Disabled' }}</span></td><td><a class="icon-link" href="{{ route('fields.edit',$field) }}">Edit →</a></td></tr>@endforeach</tbody></table></div></section>
<div class="modal-backdrop" id="field-modal"><div class="modal"><div class="modal-head"><div><span class="eyebrow">New configuration</span><h2>Add a custom field</h2></div><button type="button" data-modal-close>×</button></div><form method="POST" action="{{ route('fields.store') }}" class="form-stack">@csrf
    @include('fields.partials.form',['field'=>new \App\Models\CustomField])
    <button class="button primary full" type="submit">Create field</button>
</form></div></div>
@endsection
