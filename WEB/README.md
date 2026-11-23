# Sentinel Weighment Control

Laravel 12 application for weighbridge operations on Hostinger Cloud. It includes role-based access, configurable fields, gross/tare processing, audit history, PDF slips, and a configurable PDF report builder.

## Local setup

1. Copy `.env.example` to `.env` and generate an application key.
2. Run `composer install`, `npm install`, and `npm run build`.
3. Run `php artisan migrate --seed`.
4. Start with `php artisan serve`.

The local seeder creates administrator, operator, and viewer demonstration accounts. Replace all demonstration credentials before production use.

## Hostinger Cloud

Use PHP 8.2 or newer, MySQL, and point the website document root to Laravel's `public` directory when possible. Set production values in an uncommitted `.env`, run migrations with `--force`, and cache configuration and views after deployment.
