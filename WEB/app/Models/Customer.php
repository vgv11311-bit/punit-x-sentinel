<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class Customer extends Model
{
    protected $guarded=[];
    protected function casts(): array { return ['enabled'=>'boolean','expires_on'=>'date']; }
    public function isAvailable(): bool { return $this->enabled && (! $this->expires_on || $this->expires_on->endOfDay()->isFuture()); }
    public function users() { return $this->hasMany(User::class); }
}
