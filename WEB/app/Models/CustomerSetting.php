<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class CustomerSetting extends Model
{
    use \App\Support\BelongsToCustomer;
    protected $guarded=[];
}
