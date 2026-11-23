<?php

namespace App\Http\Controllers;

use App\Models\CustomerSetting;
use Illuminate\Http\Request;

class SettingController extends Controller
{
    public function edit()
    {
        return view('settings.edit', ['settings' => CustomerSetting::query()->pluck('value', 'key')]);
    }

    public function update(Request $request)
    {
        $data = $request->validate([
            'company_name' => ['required', 'string', 'max:120'],
            'weight_unit' => ['required', 'string', 'max:12'],
            'slip_footer' => ['nullable', 'string', 'max:250'],
        ]);
        foreach ($data as $key => $value) CustomerSetting::updateOrCreate(['key' => $key], ['value' => $value]);
        return back()->with('success', 'Application settings saved.');
    }
}
