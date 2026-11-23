@extends('layouts.app')
@section('title','Report Preview')
@section('content')
@include('reports.session-status')
<div class="page-heading"><div><a class="back-link" href="{{ route('reports.index') }}">← Edit report</a><span class="eyebrow">Preview</span><h1>{{ $meta['title'] }}</h1><p>{{ $records->count() }} records · Generated {{ now()->format('d M Y, h:i A') }}</p></div><form method="POST" action="{{ route('reports.pdf') }}">@csrf @foreach(request()->except('_token', '_report_window_token') as $key=>$value)@if(is_array($value))@foreach($value as $item)<input type="hidden" name="{{ $key }}[]" value="{{ $item }}">@endforeach @else<input type="hidden" name="{{ $key }}" value="{{ $value }}">@endif @endforeach<button class="button primary" type="submit">↓ Download PDF</button></form></div>
@if(request("format", "inward") === "inward")
<p class="microcopy">Preview of the inward cargo layout. The download contains one page per record.</p>
<iframe title="Inward cargo report preview" sandbox style="width:100%;min-height:1100px;border:1px solid #d5dddd;background:#fff" srcdoc="{{ view('pdf.inward-cargo', ['records' => $records, 'unit' => $unit])->render() }}"></iframe>
@else
<section class="panel"><div class="report-meta">@if($meta['from']||$meta['to'])<span>Date: {{ $meta['from']??'Any' }} to {{ $meta['to']??'Any' }}</span>@endif @foreach(['status','vehicle','driver','material'] as $key)@if($meta[$key])<span>{{ ucfirst($key) }}: {{ str_replace('_',' ',$meta[$key]) }}</span>@endif @endforeach</div><div class="table-scroll"><table class="data-table compact"><thead><tr>@foreach($columns as $label)<th>{{ $label }}</th>@endforeach</tr></thead><tbody>@foreach($records as $record)<tr>@foreach($columns as $key=>$label)<td>@include('reports.partials.value',['record'=>$record,'key'=>$key])</td>@endforeach</tr>@endforeach</tbody>@if($meta['include_totals'])<tfoot><tr>@foreach($columns as $key=>$label)<td>@if($loop->first)<strong>Totals</strong>@elseif(in_array($key,['gross_weight','tare_weight','net_weight']))<strong>{{ number_format($records->sum($key),3) }}</strong>@endif</td>@endforeach</tr></tfoot>@endif</table></div></section>
@endif
@endsection
