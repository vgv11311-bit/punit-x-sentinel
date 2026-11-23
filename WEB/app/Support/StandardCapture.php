<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/** Operator-confirmed receipts, never a claim of synchronized physical capture. */
class StandardCapture
{
    public static function validate(array $reported, array $record): array
    {
        $rules = [
            'mode' => ['required', 'in:standard'], 'id' => ['required', 'string', 'max:120'],
            'operatorConfirmed' => ['required', 'accepted'],
            'capturedAt' => ['required', 'integer', 'min:0'],
            'weightReceivedAt' => ['required', 'integer', 'min:0'],
            'cameras' => ['required', 'array:front,rear,container'],
        ];
        foreach (['front', 'rear', 'container'] as $role) {
            $rules['cameras.'.$role] = ['required', 'array:value,receivedAt'];
            $rules['cameras.'.$role.'.value'] = ['required', 'string', 'max:40'];
            $rules['cameras.'.$role.'.receivedAt'] = ['required', 'integer', 'min:0'];
        }
        $data = Validator::make($reported, $rules)->validate();
        $error = fn () => throw ValidationException::withMessages(['capture_workflow' => 'Standard capture must match the recorded identifiers and recent device receipts.']);
        if (array_diff(array_keys($reported), ['mode','id','operatorConfirmed','capturedAt','weightReceivedAt','cameras'])) $error();
        if (isset($record['capture_evidence']) || $data['id'] !== $record['request_id'] || strcasecmp($record['gross_source'], 'Live') !== 0) $error();
        $age = $data['capturedAt'] - $data['weightReceivedAt'];
        if ($age < 0 || $age > 3000) $error();
        $savedAt = (float) CarbonImmutable::parse($record['gross_captured_at'])->format('U.u') * 1000;
        if (abs($savedAt - $data['weightReceivedAt']) > 1) $error();
        $expected = ['front' => $record['vehicle_plate'], 'rear' => $record['custom']['trailer_no'] ?? null, 'container' => $record['custom']['container_no'] ?? null];
        foreach ($expected as $role => $value) {
            $age = $data['capturedAt'] - $data['cameras'][$role]['receivedAt'];
            if (! $value || $data['cameras'][$role]['value'] !== $value || $age < 0 || $age > 30000) $error();
        }
        return $data;
    }

    public static function fingerprint(array $data): string
    {
        $sort = function (array $value) use (&$sort): array {
            ksort($value);
            foreach ($value as &$item) if (is_array($item)) $item = $sort($item);
            return $value;
        };
        return hash('sha256', json_encode($sort($data), JSON_THROW_ON_ERROR));
    }
}
