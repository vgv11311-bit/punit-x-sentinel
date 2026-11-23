# Sentinel Live API

Base URL: `https://sentinel.puniterp.com/api/v1`

All data endpoints require:

```http
Authorization: Bearer YOUR_TOKEN
Accept: application/json
```

## Authentication

### Create or replace a token

`POST /auth/token`

```json
{
  "email": "sentinel@gmail.com",
  "password": "YOUR_PASSWORD"
}
```

The response returns the token once. Store it securely.

### Current API user

`GET /me`

### Revoke the current token

`DELETE /auth/token`

## Weighments

### Create a Gross record

`POST /weighments`

Administrator or operator role required. `request_id` makes retries idempotent: resending the same request returns the original web record.

```json
{
  "vehicle_plate_number": "RJ14 AB 1234",
  "gross_weight": 28000,
  "gross_source": "Live",
  "gross_captured_at": "2026-11-05T15:44:00+05:30",
  "device": "COM3",
  "request_id": "GROSS-UNIQUE-ID",
  "status": "tare_pending",
  "custom_fields": {}
}
```

A new record returns `201`. A repeated `request_id` returns `200` with the same `id`.

### List records

`GET /weighments`

Optional query parameters: `search`, `status`, `from`, `to`, `page`, `per_page` (maximum 100).

Example: `GET /weighments?status=completed&from=2026-11-01&per_page=50`

### Get one record

`GET /weighments/{id}`

The detailed response includes custom field values and audit history.

### Update one record

`PUT /weighments/{id}`

Administrator or operator role required. Completed records can only be corrected by an administrator.

```json
{
  "vehicle_plate": "RJ14 AB 1234",
  "driver_name": "Ravi",
  "material": "Wheat",
  "gross_weight": 25000,
  "tare_weight": 9000,
  "notes": "Updated through API",
  "custom": {
    "supplier": "Supplier name",
    "quality_check": true
  }
}
```

Net weight, status, completion time, and audit history are calculated automatically.

For a desktop Tare synchronization, only the Tare value is required:

```json
{
  "tare_weight": 10000
}
```

The API retains the original Gross data and calculates net weight automatically.

## Dynamic fields

- `GET /fields`
- `GET /fields/{id}`
- `PUT /fields/{id}` — administrator only

Complete update body:

```json
{
  "name": "Supplier",
  "type": "text",
  "options": null,
  "sort_order": 10,
  "is_required": false,
  "is_searchable": true,
  "is_filterable": true,
  "show_in_list": true,
  "show_in_pdf": true,
  "show_in_reports": true,
  "is_active": true
}
```

Supported types: `text`, `number`, `date`, `datetime`, `dropdown`, `checkbox`.

## Configuration

- `GET /settings`
- `PUT /settings` — administrator only

```json
{
  "company_name": "Lilaram Food Products",
  "weight_unit": "kg",
  "slip_footer": "Computer-generated weighment slip"
}
```

Valid weight units: `kg`, `tonnes`, `lb`.

## Status codes

- `200` successful GET or PUT
- `201` token or Gross record created
- `401` missing or invalid token
- `403` role not permitted
- `404` record not found
- `422` validation failed
- `429` rate limit exceeded
