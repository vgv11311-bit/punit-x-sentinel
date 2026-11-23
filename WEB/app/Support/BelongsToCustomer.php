<?php
namespace App\Support;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
trait BelongsToCustomer
{
    protected static function bootBelongsToCustomer(): void
    {
        static::addGlobalScope('customer', function (Builder $builder) {
            $user=Auth::user();
            if ($user && $user->customer_id) $builder->where($builder->getModel()->qualifyColumn('customer_id'),$user->customer_id);
            elseif (! app()->runningInConsole() || $user) $builder->whereRaw('1=0');
        });
        static::creating(function (Model $model) {
            if ($user=Auth::user()) {
                if (! $user->customer_id) throw new \RuntimeException('No customer is selected.');
                $model->customer_id=$user->customer_id;
            }
            elseif (app()->runningInConsole() && ! $model->customer_id) $model->customer_id=\App\Models\Customer::query()->orderBy('id')->value('id');
        });
    }
}
