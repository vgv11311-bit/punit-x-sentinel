@extends('layouts.app')
@section('title','Configuration')
@section('content')
<div class="page-heading"><div><span class="eyebrow">System preferences</span><h1>Configuration</h1><p>Set the identity and measurement conventions used throughout Sentinel.</p></div></div>
<section class="panel form-card narrow"><form method="POST" action="{{ route('settings.update') }}" class="form-stack">@csrf @method('PUT')<label>Company name <b>*</b><input name="company_name" value="{{ old('company_name',$settings['company_name']??'') }}" required></label><label>Weight unit <b>*</b><select name="weight_unit"><option @selected(($settings['weight_unit']??'kg')==='kg')>kg</option><option @selected(($settings['weight_unit']??'')==='tonnes')>tonnes</option><option @selected(($settings['weight_unit']??'')==='lb')>lb</option></select></label><label>PDF slip footer<textarea name="slip_footer" rows="3">{{ old('slip_footer',$settings['slip_footer']??'') }}</textarea></label><button class="button primary" type="submit">Save configuration</button></form></section>
@endsection
