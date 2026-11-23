<?php

namespace App\Http\Controllers;

use App\Models\CustomField;
use App\Models\Setting;
use App\Models\Weighment;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function completed(Request $request)
    {
        $request->validate(['search'=>['nullable','string','max:120'], 'from'=>['nullable','date'], 'to'=>['nullable','date','after_or_equal:from']]);
        $query = Weighment::query()->with('values.field')->where('status', 'completed');
        if ($search = trim((string) $request->input('search'))) {
            $query->where(fn ($q) => $q->where('vehicle_plate','like',"%{$search}%")->orWhere('weighment_no','like',"%{$search}%")->orWhere('driver_name','like',"%{$search}%")->orWhere('material','like',"%{$search}%")->orWhereHas('values',fn ($v)=>$v->where('value','like',"%{$search}%")));
        }
        if ($request->filled('from')) $query->whereDate('completed_at','>=',$request->input('from'));
        if ($request->filled('to')) $query->whereDate('completed_at','<=',$request->input('to'));
        return view('completed', ['records'=>$query->latest('completed_at')->paginate(15)->withQueryString(), 'unit'=>Setting::valueFor('weight_unit','kg')]);
    }

    public function index(Request $request)
    {
        if ($request->user()->isSuperAdmin()) return redirect()->route('super.customers.index');
        $query = Weighment::query()->with('values');
        if ($search = trim((string) $request->input('search'))) {
            $query->where(function ($q) use ($search) {
                $q->where('vehicle_plate', 'like', "%{$search}%")
                    ->orWhere('weighment_no', 'like', "%{$search}%")
                    ->orWhere('driver_name', 'like', "%{$search}%")
                    ->orWhere('material', 'like', "%{$search}%")
                    ->orWhereHas('values', fn ($v) => $v->where('value', 'like', "%{$search}%"));
            });
        }
        if ($status = $request->input('status')) $query->where('status', $status);
        if ($request->filled('from')) $query->whereDate('first_weighed_at', '>=', $request->input('from'));
        if ($request->filled('to')) $query->whereDate('first_weighed_at', '<=', $request->input('to'));
        if ($request->filled('driver')) $query->where('driver_name', 'like', '%'.$request->input('driver').'%');
        if ($request->filled('material')) $query->where('material', 'like', '%'.$request->input('material').'%');

        foreach (CustomField::where('is_filterable', true)->get() as $field) {
            if ($request->filled('field_'.$field->id)) {
                $value = $request->input('field_'.$field->id);
                $query->whereHas('values', fn ($q) => $q->where('custom_field_id', $field->id)->where('value', 'like', "%{$value}%"));
            }
        }

        return view('dashboard', [
            'records' => $query->latest('first_weighed_at')->paginate(12)->withQueryString(),
            'counts' => [
                'gross_pending' => Weighment::where('status', 'gross_pending')->count(),
                'tare_pending' => Weighment::where('status', 'tare_pending')->count(),
                'completed' => Weighment::where('status', 'completed')->count(),
            ],
            'listFields' => CustomField::where('is_active', true)->where('show_in_list', true)->orderBy('sort_order')->get(),
            'filterFields' => CustomField::where('is_active', true)->where('is_filterable', true)->orderBy('sort_order')->get(),
            'unit' => Setting::valueFor('weight_unit', 'kg'),
        ]);
    }
}
