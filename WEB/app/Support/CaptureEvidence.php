<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/** Validates client-reported consistency only; this cannot authenticate devices or prove physical timing. */
class CaptureEvidence
{
    public static function validate(array $reported, array $record): array
    {
        $rules = [
            'id' => ['required', 'string', 'max:120'],
            'weightKg' => ['required', 'numeric', 'gt:0'],
            'weightAt' => ['required', 'integer', 'min:0'],
            'weightUncertaintyMs' => ['required', 'numeric', 'min:0', 'max:1000'],
            'maxSkewMs' => ['required', 'numeric', 'min:0', 'max:1000'],
            'cameras' => ['required', 'array:front,rear,container'],
        ];
        foreach (['front', 'rear', 'container'] as $role) {
            $rules['cameras.'.$role] = ['required', 'array:eventId,value,capturedAt,timestampResolutionMs,clockUncertaintyMs'];
            $rules['cameras.'.$role.'.eventId'] = ['required', 'string', 'max:200'];
            $rules['cameras.'.$role.'.value'] = ['required', 'string', 'max:40'];
            $rules['cameras.'.$role.'.capturedAt'] = ['required', 'integer', 'min:0'];
            $rules['cameras.'.$role.'.timestampResolutionMs'] = ['required', 'numeric', 'gt:0', 'max:1000'];
            $rules['cameras.'.$role.'.clockUncertaintyMs'] = ['required', 'numeric', 'min:0', 'max:1000'];
        }
        $validated = Validator::make($reported, $rules)->validate();
        $error = fn () => throw ValidationException::withMessages(['capture_evidence' => 'Capture evidence is inconsistent with the weighment or the one-second timing limit.']);
        if (array_diff(array_keys($reported), ['id','weightKg','weightAt','weightUncertaintyMs','maxSkewMs','cameras'])) $error();
        if ($validated['id'] !== $record['request_id'] || strcasecmp($record['gross_source'], 'Live') !== 0 || abs((float) $validated['weightKg'] - (float) $record['gross_weight']) > 0.00001) $error();
        $savedAtMs = (float) CarbonImmutable::parse($record['gross_captured_at'])->format('U.u') * 1000;
        if (abs($savedAtMs - (float) $validated['weightAt']) > 1) $error();
        $normalize = fn ($value) => strtoupper(preg_replace('/\s+/', '', trim((string) $value)));
        $expected = ['front' => $record['vehicle_plate'], 'rear' => $record['custom']['trailer_no'] ?? null, 'container' => $record['custom']['container_no'] ?? null];
        $seen = [];
        foreach (['front', 'rear', 'container'] as $role) {
            $camera = $validated['cameras'][$role];
            if (! $expected[$role] || $normalize($camera['value']) !== $normalize($expected[$role])) $error();
            if (in_array($camera['eventId'], $seen, true)) $error();
            $seen[] = $camera['eventId'];
            $weightAt = (float) $validated['weightAt'];
            $weightUncertainty = (float) $validated['weightUncertaintyMs'];
            $capturedAt = (float) $camera['capturedAt'];
            $clockUncertainty = (float) $camera['clockUncertaintyMs'];
            if ($capturedAt - $clockUncertainty < $weightAt + $weightUncertainty) $error();
            if (abs($capturedAt - $weightAt) + (float) $camera['timestampResolutionMs'] + $clockUncertainty + $weightUncertainty > (float) $validated['maxSkewMs']) $error();
        }
        return $validated;
    }
}
