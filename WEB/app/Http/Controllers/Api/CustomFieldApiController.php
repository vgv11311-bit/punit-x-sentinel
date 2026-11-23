<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CustomField;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CustomFieldApiController extends Controller
{
    public function index()
    {
        return response()->json(['data' => CustomField::orderBy('sort_order')->get()]);
    }

    public function show(CustomField $field)
    {
        return response()->json(['data' => $field]);
    }

    public function update(Request $request, CustomField $field)
    {
        abort_unless($request->user()->isAdmin(), 403, 'Only an administrator can update dynamic fields.');
        $data = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'type' => ['required', Rule::in(['text', 'number', 'date', 'datetime', 'dropdown', 'checkbox'])],
            'options' => ['nullable', 'array'],
            'options.*' => ['string', 'max:120'],
            'sort_order' => ['required', 'integer', 'min:0', 'max:999'],
            'is_required' => ['required', 'boolean'],
            'is_searchable' => ['required', 'boolean'],
            'is_filterable' => ['required', 'boolean'],
            'show_in_list' => ['required', 'boolean'],
            'show_in_pdf' => ['required', 'boolean'],
            'show_in_reports' => ['required', 'boolean'],
            'is_active' => ['required', 'boolean'],
        ]);
        $data['options'] = $data['type'] === 'dropdown' ? array_values(array_filter(array_map('trim', $data['options'] ?? []))) : null;
        $field->update($data);
        return response()->json(['data' => $field->fresh()]);
    }
}
