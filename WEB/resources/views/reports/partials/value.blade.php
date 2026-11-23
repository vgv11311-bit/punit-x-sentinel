@php
    $value = str_starts_with($key, 'custom_') ? $record->customValue((int) str_replace('custom_', '', $key)) : $record->$key;
    $missing = $value === null || trim((string) $value) === '';
@endphp
@if($missing)N/A
@elseif($key==='first_weighed_at'){{ $record->first_weighed_at->format('d M Y, h:i A') }}
@elseif(in_array($key,['gross_weight','tare_weight','net_weight'])){{ number_format($value,3) }}
@elseif($key==='status'){{ ucwords(str_replace('_',' ',$value)) }}
@else{{ $value }}@endif
