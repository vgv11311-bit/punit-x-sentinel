<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WeighmentValue extends Model
{
    protected $guarded = [];
    public function field() { return $this->belongsTo(CustomField::class, 'custom_field_id'); }
}
