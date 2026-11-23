<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{margin:34px 42px}body{font-family:DejaVu Sans Mono,monospace;color:#000;font-size:9px}.page{page-break-after:always}.page:last-child{page-break-after:auto}.logo-image{display:block;width:160px;height:auto}.heading{text-align:center;margin:22px 0 25px;font-size:12px;line-height:1.5}.heading strong{font-size:14px}.rule{border:0;border-top:1px solid #000;margin:10px 0 16px}h2{text-align:center;font-size:13px;margin:18px 0}.fields{width:100%;border-collapse:collapse}.fields td{width:25%;padding:4px 2px;vertical-align:top}.fields .label{font-weight:bold}.survey{margin-top:30px}.survey p{line-height:1.65}.options{width:100%;margin:18px 0}.options td{width:50%;vertical-align:top}.line{border-bottom:1px solid #000;display:inline-block;width:230px;height:12px}.sign{margin:15px 0}.empty{text-align:center;margin-top:40px}
</style></head><body>@forelse($records as $record)
@php
$display = fn ($value) => $value === null || trim((string) $value) === '' ? 'N/A' : trim((string) $value);
$normalize = fn ($value) => strtolower(preg_replace('/[^a-z0-9]/i', '', (string) $value));
// Prefer canonical slugs, then legacy names. A blank duplicate must not hide a saved value.
$custom = function ($names) use ($record, $display, $normalize) {
    foreach (['slug', 'name'] as $attribute) {
        foreach ($names as $name) {
            foreach ($record->values as $value) {
                if ($value->field && $normalize($value->field->$attribute) === $normalize($name) && $value->value !== null && trim((string) $value->value) !== '') {
                    return $display($value->value);
                }
            }
        }
    }
    return 'N/A';
};
$productCountDesc = $custom(['product_count_desc']);
if ($productCountDesc === 'N/A') { $count = $custom(['product_count', 'no_of_packages', 'no_of_packages_count']); $desc = $custom(['product_desc', 'product_description']); $productCountDesc = $count === 'N/A' && $desc === 'N/A' ? 'N/A' : $count.' - '.$desc; }
$weightIn = $record->gross_weight !== null && trim((string) $record->gross_weight) !== '' ? rtrim(rtrim(number_format((float) $record->gross_weight, 3, '.', ''), '0'), '.').' '.(strtolower($unit) === 'kg' ? 'Kg' : $unit) : 'N/A';
$vehicle = $display($record->vehicle_plate);
$product = $display($record->material);
$container = $custom(['container_no','container_number']);
$customer = auth()->user()?->customer;
$legacyBrand = ! $customer || $customer->legacy_report_brand;
$companyName = $customer?->name ?? 'Sentinel';
$rows = [
 ['TIME IN', $display(optional($record->first_weighed_at)->format('Y-m-d H:i')),'Gate',$custom(['gate'])],
 ['Vehicle No', $vehicle,'Weight In', $weightIn],
 ['Trailer No',$custom(['trailer_no','trailer_number','truck_trailer_plate_no','rear_plate','rear_number_plate']),'Product',$product],
 ['Container No',$container,'Product Count-Desc',$productCountDesc],
 ['Container Type',$custom(['container_type']),'Customer/Client Name',$custom(['customer_client_name','customer_name','client_name'])],
 ['Container Size',$custom(['container_size']),'Agent Name',$custom(['agent_name'])],
 ["Driver's Name",$display($record->driver_name),'Transporter',$custom(['transporter'])],
 ["Driver's Licence",$custom(['drivers_licence','driver_licence','drivers_licence_no','driver_licence_no','drivers_license','driver_license','drivers_license_no','driver_license_no']),'Cargo-TYPE',$custom(['cargo_type','cargo_info_type'])],
];
@endphp
<div class="page">@if($legacyBrand)<img class="logo-image" alt="Donito Investmentt Limited" src="data:image/png;base64,{{ base64_encode(file_get_contents(resource_path('images/donito-report-logo.png'))) }}">@endif<div class="heading"><strong>{{ $legacyBrand ? 'DONITO INVESTMENT LTD - CFS #056' : $companyName }}</strong><br>WEIGHT-BRIDGE@if($legacyBrand)<br>PO.BOX:80445,DSM@endif</div><hr class="rule"><h2>Inward cargo Report</h2><table class="fields">@foreach($rows as $row)<tr><td class="label">{{ $row[0] }}</td><td>: {{ $row[1] }}</td><td class="label">{{ $row[2] }}</td><td>: {{ $row[3] }}</td></tr>@endforeach</table><hr class="rule"><div class="survey"><h2>Surveyor's Report</h2><p><strong>Put a tick on one of the boxes provided:</strong></p><p>Did the truck: {{ $vehicle }} leave with the container {{ $container }} after offloading the product: {{ $product }}?</p><table class="options"><tr><td>Yes (Truck left with container {{ $container }}) □</td><td>No (Truck offloaded the container {{ $container }}) □</td></tr></table><div class="sign">Surveyor Incharge Name: <span class="line"></span></div><div class="sign">Surveyor Incharge Signature: <span class="line"></span></div></div><hr class="rule"></div>
@empty<div class="empty">No records match the selected filters.</div>@endforelse</body></html>
