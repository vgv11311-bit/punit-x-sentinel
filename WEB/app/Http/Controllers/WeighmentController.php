<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\CustomField;
use App\Models\Setting;
use App\Models\Weighment;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class WeighmentController extends Controller
{
    public function create() { abort(403, 'New weighments must be captured with the connected devices in the desktop app.'); }

    public function store(Request $request)
    {
        abort(403, 'New weighments must be captured with the connected devices in the desktop app.');
    }

    public function show(Weighment $weighment)
    {
        $weighment->load(['values.field', 'audits.user', 'creator', 'updater']);
        return view('weighments.show', ['weighment' => $weighment, 'unit' => Setting::valueFor('weight_unit', 'kg')]);
    }

    public function edit(Weighment $weighment)
    {
        abort_if(strcasecmp((string) $weighment->gross_source, 'Live') === 0, 403, 'Device-captured weighments must be completed in the desktop app.');
        $weighment->load('values');
        return view('weighments.form', ['weighment' => $weighment, 'fields' => $this->fields(true), 'unit' => Setting::valueFor('weight_unit', 'kg')]);
    }

    public function update(Request $request, Weighment $weighment)
    {
        abort_if(strcasecmp((string) $weighment->gross_source, 'Live') === 0, 403, 'Device-captured weighments cannot be manually edited on the website.');
        if ($weighment->status === 'completed' && ! $request->user()->isAdmin()) abort(403, 'Only an administrator can correct a completed weighment.');
        $before = $weighment->only(['vehicle_plate', 'driver_name', 'material', 'gross_weight', 'tare_weight', 'net_weight', 'status']);
        $data = $this->validateRecord($request, $weighment);
        DB::transaction(function () use ($request, $data, $weighment, $before) {
            $weighment->update($this->recordData($data, $request, $weighment));
            $this->saveValues($weighment, $request);
            $this->audit($weighment, $request, $before['status'] !== 'completed' && $weighment->status === 'completed' ? 'completed' : 'updated', ['before' => $before, 'after' => $weighment->fresh()->only(array_keys($before))]);
        });
        return redirect()->route('weighments.show', $weighment)->with('success', 'Weighment updated and audit history recorded.');
    }

    public function pdf(Request $request, Weighment $weighment)
    {
        if ($denied = \App\Support\ReportAccess::denyUnlessConfirmed($request)) return $denied;
        $weighment->load(['values.field', 'creator']);
        return Pdf::loadView('pdf.inward-cargo', [
            'records' => collect([$weighment]),
            'unit' => Setting::valueFor('weight_unit', 'kg'),
        ])->setPaper('a4', 'portrait')->download('Inward-Cargo-'.$weighment->id.'.pdf')->header('Cache-Control', 'no-store, private');
    }

    private function validateRecord(Request $request, ?Weighment $weighment = null): array
    {
        $rules = [
            'vehicle_plate' => ['required', 'string', 'max:40'],
            'driver_name' => ['nullable', 'string', 'max:120'], 'material' => ['nullable', 'string', 'max:120'],
            'gross_weight' => ['required', 'numeric', 'gt:0'], 'tare_weight' => ['nullable', 'numeric', 'gt:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
        foreach ($this->fields($weighment !== null) as $field) {
            $fieldRules = [$field->is_required ? 'required' : 'nullable'];
            if ($field->type === 'number') $fieldRules[] = 'numeric';
            if ($field->type === 'date') $fieldRules[] = 'date';
            if ($field->type === 'datetime') $fieldRules[] = 'date';
            if ($field->type === 'dropdown' && $field->options) $fieldRules[] = 'in:'.implode(',', $field->options);
            $rules['custom.'.$field->id] = $fieldRules;
        }
        $data = $request->validate($rules);
        if (! empty($data['tare_weight']) && (float) $data['tare_weight'] > (float) $data['gross_weight']) {
            throw ValidationException::withMessages(['tare_weight' => 'Tare weight cannot be greater than gross weight. Verify both values.']);
        }
        return $data;
    }

    private function recordData(array $data, Request $request, ?Weighment $weighment): array
    {
        $tare = $data['tare_weight'] ?? null;
        return [
            'weighment_no' => $weighment?->weighment_no ?? 'PENDING-'.uniqid(),
            'vehicle_plate' => strtoupper(trim($data['vehicle_plate'])), 'driver_name' => $data['driver_name'] ?? null,
            'material' => $data['material'] ?? null, 'gross_weight' => $data['gross_weight'], 'tare_weight' => $tare,
            'net_weight' => $tare ? (float) $data['gross_weight'] - (float) $tare : null,
            'status' => $tare ? 'completed' : 'tare_pending',
            'first_weighed_at' => $weighment?->first_weighed_at ?? now(), 'completed_at' => $tare ? now() : null,
            'notes' => $data['notes'] ?? null, 'created_by' => $weighment?->created_by ?? $request->user()->id,
            'updated_by' => $request->user()->id,
        ];
    }

    private function saveValues(Weighment $weighment, Request $request): void
    {
        foreach ($this->fields(true) as $field) {
            $value = $request->input('custom.'.$field->id);
            if ($field->type === 'checkbox') $value = $request->boolean('custom.'.$field->id) ? '1' : '0';
            $weighment->values()->updateOrCreate(['custom_field_id' => $field->id], ['value' => $value]);
        }
    }

    private function audit(Weighment $weighment, Request $request, string $action, array $changes): void
    {
        AuditLog::create(['weighment_id' => $weighment->id, 'user_id' => $request->user()->id, 'action' => $action, 'changes' => $changes, 'ip_address' => $request->ip()]);
    }

    private function fields(bool $includeInactive = false)
    {
        return CustomField::query()->when(! $includeInactive, fn ($q) => $q->where('is_active', true))->orderBy('sort_order')->get();
    }
}
