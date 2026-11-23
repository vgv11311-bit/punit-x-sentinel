# SENTINEL

SENTINEL is a weighbridge management system with two applications:

- `APP/` — Windows Electron desktop app for capturing live Gross and Tare weights over RS-232/USB serial connections and synchronizing records with the web API.
- `WEB/` — Laravel web application and REST API for weighments, dynamic fields, settings, authentication, and audit history.

## Setup

See [`APP/README.md`](APP/README.md) for the desktop application and [`WEB/README.md`](WEB/README.md) for the web application.

The desktop client uses the API documented in [`WEB/API.md`](WEB/API.md).

## Security

Environment files, API credentials, local databases, dependencies, generated builds, installers, caches, and runtime logs are intentionally excluded from source control. Copy the appropriate `.env.example` file when configuring a deployment.
