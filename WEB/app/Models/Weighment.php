<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Weighment extends Model
{
    use \App\Support\BelongsToCustomer;
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'first_weighed_at' => 'datetime',
            'gross_captured_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    public function values() { return $this->hasMany(WeighmentValue::class); }
    public function audits() { return $this->hasMany(AuditLog::class)->latest(); }
    public function creator() { return $this->belongsTo(User::class, 'created_by'); }
    public function updater() { return $this->belongsTo(User::class, 'updated_by'); }

    public function customValue(int $fieldId): ?string
    {
        return $this->values->firstWhere('custom_field_id', $fieldId)?->value;
    }
}
