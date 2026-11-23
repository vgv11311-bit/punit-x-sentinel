<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CustomField extends Model
{
    use \App\Support\BelongsToCustomer;
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'options' => 'array',
            'is_required' => 'boolean', 'is_searchable' => 'boolean',
            'is_filterable' => 'boolean', 'show_in_list' => 'boolean',
            'show_in_pdf' => 'boolean', 'show_in_reports' => 'boolean',
            'is_active' => 'boolean',
        ];
    }
}
