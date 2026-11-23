<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        'role',
        'customer_id',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
        'api_token_hash',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'api_token_created_at' => 'datetime',
        ];
    }

    public function isAdmin(): bool
    {
        return $this->role === 'administrator';
    }

    public function customer() { return $this->belongsTo(Customer::class); }
    public function isSuperAdmin(): bool { return $this->role === 'super_admin'; }
    public function accountAvailable(): bool { return $this->isSuperAdmin() || ($this->customer_id && Customer::query()->find($this->customer_id)?->isAvailable()); }

    public function canOperate(): bool
    {
        return in_array($this->role, ['administrator', 'operator'], true);
    }
}
