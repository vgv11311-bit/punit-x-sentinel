<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CustomerSetting;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SettingApiController extends Controller
{
    public function index()
    {
        return response()->json(['data' => CustomerSetting::query()->pluck('value', 'key')]);
    }

    public function update(Request $request)
    {
        abort_unless($request->user()->isAdmin(), 403, 'Only an administrator can update configuration.');
        $data = $request->validate([
            'company_name' => ['required', 'string', 'max:120'],
            'weight_unit' => ['required', Rule::in(['kg', 'tonnes', 'lb'])],
            'slip_footer' => ['nullable', 'string', 'max:250'],
        ]);
        foreach ($data as $key => $value) CustomerSetting::updateOrCreate(['key' => $key], ['value' => $value]);
        return $this->index();
    }
}
