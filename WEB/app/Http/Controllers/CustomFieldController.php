<?php

namespace App\Http\Controllers;

use App\Models\CustomField;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class CustomFieldController extends Controller
{
    public function index() { return view('fields.index', ['fields' => CustomField::orderBy('sort_order')->get()]); }

    public function store(Request $request)
    {
        $data = $this->validated($request);
        $data['slug'] = $this->uniqueSlug($data['name']);
        $data['created_by'] = $request->user()->id;
        CustomField::create($data);
        return back()->with('success', 'Custom field created.');
    }

    public function edit(CustomField $field) { return view('fields.edit', compact('field')); }

    public function update(Request $request, CustomField $field)
    {
        $field->update($this->validated($request, $field));
        return redirect()->route('fields.index')->with('success', 'Field settings updated without changing historical values.');
    }

    public function destroy(CustomField $field)
    {
        $field->update(['is_active' => false]);
        return back()->with('success', 'Field disabled. Existing record values are preserved.');
    }

    private function validated(Request $request, ?CustomField $field = null): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'type' => ['required', Rule::in(['text', 'number', 'date', 'datetime', 'dropdown', 'checkbox'])],
            'options_text' => ['nullable', 'string', 'max:1000'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:999'],
        ]);
        $data['options'] = $data['type'] === 'dropdown'
            ? collect(preg_split('/\r\n|\r|\n|,/', (string) ($data['options_text'] ?? '')))->map(fn ($v) => trim($v))->filter()->values()->all()
            : null;
        unset($data['options_text']);
        foreach (['is_required', 'is_searchable', 'is_filterable', 'show_in_list', 'show_in_pdf', 'show_in_reports', 'is_active'] as $key) {
            $data[$key] = $key === 'is_active' && ! $request->has($key) && ! $field ? true : $request->boolean($key);
        }
        $data['sort_order'] = $data['sort_order'] ?? 0;
        return $data;
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name, '_') ?: 'field'; $slug = $base; $i = 2;
        while (CustomField::where('slug', $slug)->exists()) $slug = $base.'_'.$i++;
        return $slug;
    }
}
