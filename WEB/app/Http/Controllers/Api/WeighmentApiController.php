<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\CustomField;
use App\Models\Weighment;
use App\Support\CaptureEvidence;
use App\Support\StandardCapture;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class WeighmentApiController extends Controller
{
    public function index(Request $request)
    {
        $request->validate([
            'search' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', Rule::in(['gross_pending', 'tare_pending', 'completed'])],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $records = Weighment::query()->with(['values.field'])
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = '%'.$request->string('search').'%';
                $q->where(fn ($sub) => $sub->where('weighment_no', 'like', $term)->orWhere('vehicle_plate', 'like', $term)->orWhere('driver_name', 'like', $term)->orWhere('material', 'like', $term));
            })
            ->when($request->filled('from'), fn ($q) => $q->whereDate('first_weighed_at', '>=', $request->date('from')))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('first_weighed_at', '<=', $request->date('to')))
            ->latest('first_weighed_at')
            ->paginate(min(max($request->integer('per_page', 25), 1), 100));

        return response()->json([
            'data' => collect($records->items())->map(fn ($record) => $this->recordData($record))->values(),
            'meta' => ['current_page' => $records->currentPage(), 'last_page' => $records->lastPage(), 'per_page' => $records->perPage(), 'total' => $records->total()],
        ]);
    }

    public function show(Weighment $weighment)
    {
        return response()->json(['data' => $this->recordData($weighment->load(['values.field', 'audits.user', 'creator', 'updater']), true)]);
    }

    public function store(Request $request)
    {
        abort_unless($request->user()->canOperate(), 403, 'This role cannot create weighments.');
        $this->normalizeDesktopAliases($request);

        $fields = CustomField::where('is_active', true)->orderBy('sort_order')->get();
        $rules = [
            'vehicle_plate' => ['required', 'string', 'max:40'],
            'gross_weight' => ['required', 'numeric', 'gt:0'],
            'gross_source' => ['required', 'string', 'max:40'],
            'gross_captured_at' => ['required', 'date'],
            'device' => ['nullable', 'string', 'max:120'],
            'request_id' => ['required', 'string', 'max:120'],
            'status' => ['nullable', Rule::in(['tare_pending'])],
            'driver_name' => ['nullable', 'string', 'max:120'],
            'material' => ['nullable', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'custom' => ['nullable', 'array'],
            'capture_evidence' => ['sometimes', 'required', 'array'],
            'capture_workflow' => ['sometimes', 'required', 'array'],
        ];
        foreach ($fields as $field) {
            $fieldRules = [$field->is_required ? 'required' : 'nullable'];
            if ($field->type === 'number') $fieldRules[] = 'numeric';
            if (in_array($field->type, ['date', 'datetime'], true)) $fieldRules[] = 'date';
            if ($field->type === 'dropdown' && $field->options) $fieldRules[] = Rule::in($field->options);
            if ($field->type === 'checkbox') $fieldRules[] = 'boolean';
            $rules['custom.'.$field->slug] = $fieldRules;
        }
        $data = Validator::make($request->all(), $rules)->validate();
        if (array_key_exists('capture_workflow', $data)) $data['capture_workflow'] = StandardCapture::validate($data['capture_workflow'], $data);
        if (array_key_exists('capture_evidence', $data)) $data['capture_evidence'] = CaptureEvidence::validate($data['capture_evidence'], $data);

        if ($existing = Weighment::where('request_id', $data['request_id'])->first()) {
            $originalAudit = $existing->audits()->where('action', 'created')->oldest()->first();
            if (isset($data['capture_workflow']) || isset($originalAudit?->changes['capture_workflow_unverified'])) {
                if (($originalAudit?->changes['request_fingerprint'] ?? null) !== StandardCapture::fingerprint($data)) {
                    throw ValidationException::withMessages(['request_id' => 'This request ID was already used for different data. Retry the original request.']);
                }
            }
            if (isset($data['capture_evidence'])) {
                $audit = $existing->audits()->where('action', 'created')->oldest()->first();
                if (($audit?->changes['capture_evidence_unverified'] ?? null) != $data['capture_evidence']) {
                    throw ValidationException::withMessages(['capture_evidence' => 'This request ID was already used for different capture evidence.']);
                }
            }
            return response()->json(['data' => $this->syncResponse($existing)]);
        }
        if (Weighment::where('vehicle_plate', strtoupper(trim($data['vehicle_plate'])))->whereIn('status', ['gross_pending', 'tare_pending'])->exists()) {
            throw ValidationException::withMessages(['vehicle_plate_number' => 'This vehicle already has an open pending weighment.']);
        }

        $record = DB::transaction(function () use ($request, $fields, $data) {
            $capturedAt = $data['gross_captured_at'];
            $record = Weighment::create([
                'weighment_no' => 'PENDING-API-'.Str::uuid(),
                'vehicle_plate' => strtoupper(trim($data['vehicle_plate'])),
                'driver_name' => $data['driver_name'] ?? null,
                'material' => $data['material'] ?? null,
                'gross_weight' => $data['gross_weight'],
                'gross_source' => $data['gross_source'],
                'gross_captured_at' => $capturedAt,
                'device' => $data['device'] ?? null,
                'request_id' => $data['request_id'],
                'status' => 'tare_pending',
                'first_weighed_at' => $capturedAt,
                'notes' => $data['notes'] ?? null,
                'created_by' => $request->user()->id,
                'updated_by' => $request->user()->id,
            ]);
            $record->update(['weighment_no' => 'WB-'.$record->first_weighed_at->format('Ymd').'-'.str_pad((string) $record->id, 4, '0', STR_PAD_LEFT)]);

            foreach ($fields as $field) {
                if (! array_key_exists($field->slug, $data['custom'] ?? [])) continue;
                $value = $data['custom'][$field->slug];
                if ($field->type === 'checkbox') $value = $value ? '1' : '0';
                $record->values()->create(['custom_field_id' => $field->id, 'value' => $value]);
            }
            AuditLog::create([
                'weighment_id' => $record->id,
                'user_id' => $request->user()->id,
                'action' => 'created',
                'changes' => array_merge($record->only(['vehicle_plate', 'gross_weight', 'gross_source', 'gross_captured_at', 'device', 'request_id', 'status']), isset($data['capture_evidence']) ? ['capture_evidence_unverified' => $data['capture_evidence']] : [], isset($data['capture_workflow']) ? ['capture_workflow_unverified' => $data['capture_workflow'], 'request_fingerprint' => StandardCapture::fingerprint($data)] : []),
                'ip_address' => $request->ip(),
            ]);

            return $record;
        });

        return response()->json(['data' => $this->syncResponse($record)], 201);
    }

    public function update(Request $request, Weighment $weighment)
    {
        abort_unless($request->user()->canOperate(), 403, 'This role cannot update weighments.');
        abort_if($weighment->status === 'completed' && ! $request->user()->isAdmin(), 403, 'Only an administrator can correct a completed weighment.');

        $this->normalizeDesktopAliases($request);
        $weighment->load('values.field');
        if (strcasecmp((string) $weighment->gross_source, 'Live') === 0) {
            $locked = [];
            if ($request->has('vehicle_plate') && strtoupper(trim((string) $request->input('vehicle_plate'))) !== strtoupper(trim((string) $weighment->vehicle_plate))) $locked['vehicle_plate'] = 'The camera-captured plate cannot be changed.';
            if ($request->has('gross_weight') && (float) $request->input('gross_weight') !== (float) $weighment->gross_weight) $locked['gross_weight'] = 'The scale-captured gross weight cannot be changed.';
            if ($weighment->tare_weight !== null && $request->has('tare_weight') && (float) $request->input('tare_weight') !== (float) $weighment->tare_weight) $locked['tare_weight'] = 'The scale-captured tare weight cannot be changed.';
            $existing = $weighment->values->mapWithKeys(fn ($value) => [$value->field?->slug ?? '' => $value->value]);
            foreach (['quality_check', 'trailer_no', 'container_no'] as $slug) {
                if ($request->has('custom.'.$slug) && (string) $request->input('custom.'.$slug) !== (string) $existing->get($slug, '')) $locked['custom.'.$slug] = 'Camera-captured identifiers cannot be changed.';
            }
            if ($locked) throw ValidationException::withMessages($locked);
        }
        $request->merge([
            'vehicle_plate' => $request->input('vehicle_plate', $weighment->vehicle_plate),
            'driver_name' => $request->input('driver_name', $weighment->driver_name),
            'material' => $request->input('material', $weighment->material),
            'gross_weight' => $request->input('gross_weight', $weighment->gross_weight),
            'tare_weight' => $request->input('tare_weight', $weighment->tare_weight),
            'notes' => $request->input('notes', $weighment->notes),
            'custom' => $request->input('custom', $weighment->values->mapWithKeys(
                fn ($value) => [$value->field?->slug ?? (string) $value->custom_field_id => $value->value]
            )->all()),
        ]);

        $fields = CustomField::orderBy('sort_order')->get();
        $rules = [
            'vehicle_plate' => ['required', 'string', 'max:40'],
            'driver_name' => ['nullable', 'string', 'max:120'],
            'material' => ['nullable', 'string', 'max:120'],
            'gross_weight' => ['required', 'numeric', 'gt:0'],
            'tare_weight' => ['nullable', 'numeric', 'gt:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'custom' => ['nullable', 'array'],
        ];
        foreach ($fields as $field) {
            $fieldRules = [$field->is_required ? 'required' : 'nullable'];
            if ($field->type === 'number') $fieldRules[] = 'numeric';
            if (in_array($field->type, ['date', 'datetime'], true)) $fieldRules[] = 'date';
            if ($field->type === 'dropdown' && $field->options) $fieldRules[] = Rule::in($field->options);
            if ($field->type === 'checkbox') $fieldRules[] = 'boolean';
            $rules['custom.'.$field->slug] = $fieldRules;
        }
        $data = Validator::make($request->all(), $rules)->validate();
        if (! empty($data['tare_weight']) && (float) $data['tare_weight'] > (float) $data['gross_weight']) {
            throw ValidationException::withMessages(['tare_weight' => 'Tare weight cannot be greater than gross weight.']);
        }

        $before = $weighment->only(['vehicle_plate', 'driver_name', 'material', 'gross_weight', 'tare_weight', 'net_weight', 'status']);
        DB::transaction(function () use ($request, $weighment, $fields, $data, $before) {
            $tare = $data['tare_weight'] ?? null;
            $weighment->update([
                'vehicle_plate' => strtoupper(trim($data['vehicle_plate'])),
                'driver_name' => $data['driver_name'] ?? null,
                'material' => $data['material'] ?? null,
                'gross_weight' => $data['gross_weight'],
                'tare_weight' => $tare,
                'net_weight' => $tare ? (float) $data['gross_weight'] - (float) $tare : null,
                'status' => $tare ? 'completed' : 'tare_pending',
                'completed_at' => $tare ? now() : null,
                'notes' => $data['notes'] ?? null,
                'updated_by' => $request->user()->id,
            ]);
            foreach ($fields as $field) {
                if (! array_key_exists($field->slug, $data['custom'] ?? [])) continue;
                $value = $data['custom'][$field->slug];
                if ($field->type === 'checkbox') $value = $value ? '1' : '0';
                $weighment->values()->updateOrCreate(['custom_field_id' => $field->id], ['value' => $value]);
            }
            AuditLog::create([
                'weighment_id' => $weighment->id,
                'user_id' => $request->user()->id,
                'action' => $before['status'] !== 'completed' && $weighment->status === 'completed' ? 'completed' : 'updated',
                'changes' => ['before' => $before, 'after' => $weighment->fresh()->only(array_keys($before))],
                'ip_address' => $request->ip(),
            ]);
        });

        return response()->json(['data' => $this->recordData($weighment->fresh()->load(['values.field', 'audits.user', 'creator', 'updater']), true)]);
    }

    private function recordData(Weighment $record, bool $detailed = false): array
    {
        $data = [
            'id' => $record->id,
            'weighment_no' => $record->weighment_no,
            'weighment_number' => $record->weighment_no,
            'vehicle_plate' => $record->vehicle_plate,
            'vehicle_plate_number' => $record->vehicle_plate,
            'driver_name' => $record->driver_name,
            'material' => $record->material,
            'gross_weight' => $record->gross_weight !== null ? (float) $record->gross_weight : null,
            'gross_source' => $record->gross_source,
            'gross_captured_at' => optional($record->gross_captured_at)->toIso8601String(),
            'device' => $record->device,
            'request_id' => $record->request_id,
            'tare_weight' => $record->tare_weight !== null ? (float) $record->tare_weight : null,
            'net_weight' => $record->net_weight !== null ? (float) $record->net_weight : null,
            'status' => $record->status,
            'first_weighed_at' => optional($record->first_weighed_at)->toIso8601String(),
            'completed_at' => optional($record->completed_at)->toIso8601String(),
            'notes' => $record->notes,
            'custom' => $record->values->mapWithKeys(fn ($value) => [$value->field?->slug ?? (string) $value->custom_field_id => $value->value]),
            'updated_at' => optional($record->updated_at)->toIso8601String(),
        ];
        if ($detailed) {
            $data['created_by'] = $record->creator?->only(['id', 'name', 'email']);
            $data['updated_by'] = $record->updater?->only(['id', 'name', 'email']);
            $data['audits'] = $record->audits?->map(fn ($audit) => ['id' => $audit->id, 'action' => $audit->action, 'changes' => $audit->changes, 'user' => $audit->user?->only(['id', 'name']), 'created_at' => optional($audit->created_at)->toIso8601String()]);
        }
        return $data;
    }

    private function normalizeDesktopAliases(Request $request): void
    {
        if (! $request->has('vehicle_plate') && $request->has('vehicle_plate_number')) {
            $request->merge(['vehicle_plate' => $request->input('vehicle_plate_number')]);
        }
        if (! $request->has('custom') && $request->has('custom_fields')) {
            $request->merge(['custom' => $request->input('custom_fields')]);
        }
    }

    private function syncResponse(Weighment $record): array
    {
        return [
            'id' => $record->id,
            'weighment_number' => $record->weighment_no,
            'status' => $record->status,
        ];
    }
}
