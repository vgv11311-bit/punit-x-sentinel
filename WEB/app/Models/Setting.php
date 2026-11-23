<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Setting extends Model
{
    protected $primaryKey = 'key';
    public $incrementing = false;
    protected $keyType = 'string';
    protected $guarded = [];

    public static function valueFor(string $key, ?string $default = null): ?string
    {
        return CustomerSetting::query()->where('key',$key)->first()?->value ?? $default;
    }
}
