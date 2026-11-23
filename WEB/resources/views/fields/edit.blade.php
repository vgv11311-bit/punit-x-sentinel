@extends('layouts.app')
@section('title','Edit Field')
@section('content')
<div class="page-heading"><div><a class="back-link" href="{{ route('fields.index') }}">← Back to fields</a><span class="eyebrow">Configuration</span><h1>Edit {{ $field->name }}</h1><p>Changes affect new entries. Existing stored values stay available.</p></div></div>
<section class="panel form-card narrow"><form method="POST" action="{{ route('fields.update',$field) }}" class="form-stack">@csrf @method('PUT') @include('fields.partials.form',['field'=>$field])<button class="button primary" type="submit">Save field settings</button></form></section>
@endsection
