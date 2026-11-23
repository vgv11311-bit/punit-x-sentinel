<?php

namespace App\Http\Controllers;

use App\Support\ReportAccess;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use App\Models\CustomField;
use App\Models\Setting;
use App\Models\Weighment;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ReportController extends Controller
{
    private array $standard = [
        'weighment_no' => 'Weighment No.', 'vehicle_plate' => 'Vehicle Plate', 'first_weighed_at' => 'Date & Time',
        'driver_name' => 'Driver Name', 'material' => 'Material', 'gross_weight' => 'Gross',
        'tare_weight' => 'Tare', 'net_weight' => 'Net', 'status' => 'Status',
    ];

    public function index(Request $request)
    {
        $request->validate(['download' => ['nullable', 'integer', 'min:1', Rule::exists('weighments','id')->where('customer_id',$request->user()->customer_id)]]);
        if (ReportAccess::confirmed($request)) {
            return response()->view('reports.index', ['columns' => $this->availableColumns()])->header('Cache-Control', 'no-store, private');
        }
        return response()->view('reports.unlock')->header('Cache-Control', 'no-store, private');
    }

    public function unlock(Request $request)
    {
        $data = $request->validate(['password' => ['required', 'string', 'max:1024']]);
        if (! Hash::check($data['password'], $request->user()->getAuthPassword())) {
            throw ValidationException::withMessages(['password' => 'The password is incorrect.']);
        }
        $token = Str::random(64);
        $windows = $request->session()->get('reports_windows', []);
        $windows[hash('sha256', $token)] = ['user_id' => $request->user()->id, 'confirmed_at' => now()->toIso8601String(), 'password_stamp' => hash('sha256', $request->user()->getAuthPassword())];
        $request->session()->put('reports_windows', array_slice($windows, -8, null, true));
        $request->session()->put('reports_last_login', now()->toIso8601String());
        return response()->json(['token' => $token, 'last_login' => session('reports_last_login')])->header('Cache-Control', 'no-store, private');
    }

    public function lock(Request $request)
    {
        $token = $request->input('_report_window_token');
        if (is_string($token) && strlen($token) === 64) {
            $windows = $request->session()->get('reports_windows', []);
            unset($windows[hash('sha256', $token)]);
            $request->session()->put('reports_windows', $windows);
        }
        return response()->noContent();
    }

    public function preview(Request $request)
    {
        if ($denied = ReportAccess::denyUnlessConfirmed($request)) return $denied;
        [$records, $columns, $meta] = $this->build($request);
        $unit = Setting::valueFor('weight_unit', 'kg');
        return response()->view('reports.preview', compact('records', 'columns', 'meta', 'unit'))->header('Cache-Control', 'no-store, private');
    }

    public function pdf(Request $request)
    {
        if ($denied = ReportAccess::denyUnlessConfirmed($request)) return $denied;
        [$records, $columns, $meta] = $this->build($request);
        return Pdf::loadView($request->input('format') === 'inward' ? 'pdf.inward-cargo' : 'pdf.report', [
            'records' => $records, 'columns' => $columns, 'meta' => $meta,
            'company' => Setting::valueFor('company_name', 'Sentinel Weighment'),
            'unit' => Setting::valueFor('weight_unit', 'kg'),
        ])->setPaper('a4', $request->input('format') === 'inward' ? 'portrait' : (count($columns) > 6 ? 'landscape' : 'portrait'))->download('Weighment-Report-'.now()->format('Ymd-His').'.pdf')->header('Cache-Control', 'no-store, private');
    }

    public function inwardPdf(Weighment $weighment)
    {
        abort(403, 'Reports are available only on the website after password confirmation.');
    }

    public function desktopInwardPdf(Request $request, Weighment $weighment)
    {
        $data = $request->validate(['password' => ['required', 'string', 'max:1024']]);
        if (! Hash::check($data['password'], $request->user()->getAuthPassword())) {
            throw ValidationException::withMessages(['password' => 'The password is incorrect.']);
        }
        abort_unless($weighment->status === 'completed', 422, 'Only completed records have a downloadable report.');
        $weighment->load('values.field');
        return Pdf::loadView('pdf.inward-cargo', ['records' => collect([$weighment]), 'unit' => Setting::valueFor('weight_unit', 'kg')])
            ->setPaper('a4', 'portrait')->download('Inward-Cargo-'.$weighment->id.'.pdf')->header('Cache-Control', 'no-store, private');
    }

    private function build(Request $request): array
    {
        $available = $this->availableColumns();
        $data = $request->validate([
            'format' => ['nullable', Rule::in(['inward', 'table'])], 'title' => ['nullable', 'string', 'max:120'], 'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'],
            'status' => ['nullable', Rule::in(['gross_pending', 'tare_pending', 'completed'])],
            'vehicle' => ['nullable', 'string', 'max:40'], 'driver' => ['nullable', 'string', 'max:120'], 'material' => ['nullable', 'string', 'max:120'],
            'columns' => ['required', 'array', 'min:1'], 'columns.*' => ['required', Rule::in(array_keys($available))], 'include_totals' => ['nullable'],
        ]);
        $query = Weighment::query()->with('values.field');
        if (! empty($data['from'])) $query->whereDate('first_weighed_at', '>=', $data['from']);
        if (! empty($data['to'])) $query->whereDate('first_weighed_at', '<=', $data['to']);
        if (! empty($data['status'])) $query->where('status', $data['status']);
        foreach (['vehicle_plate' => 'vehicle', 'driver_name' => 'driver', 'material' => 'material'] as $column => $key) {
            if (! empty($data[$key])) $query->where($column, 'like', '%'.$data[$key].'%');
        }
        $records = $query->orderBy('first_weighed_at')->get();
        $columns = collect($data['columns'])->mapWithKeys(fn ($key) => [$key => $available[$key]])->all();
        return [$records, $columns, [
            'title' => ($data['title'] ?? null) ?: 'Weighment Report', 'from' => $data['from'] ?? null, 'to' => $data['to'] ?? null,
            'status' => $data['status'] ?? null, 'vehicle' => $data['vehicle'] ?? null, 'driver' => $data['driver'] ?? null,
            'material' => $data['material'] ?? null, 'include_totals' => $request->boolean('include_totals'),
        ]];
    }

    private function availableColumns(): array
    {
        $columns = $this->standard;
        foreach (CustomField::where('is_active', true)->where('show_in_reports', true)->orderBy('sort_order')->get() as $field) {
            $columns['custom_'.$field->id] = $field->name;
        }
        return $columns;
    }
}
