# Spacial Pro Backend

Spring Boot API for authentication, user profile, scan metadata, model upload, and model file delivery.

## Stack
- Java 17
- Spring Boot 3.3.x
- Spring Web + Validation
- Spring Data JPA
- Spring Security
- PostgreSQL
- Local filesystem or Cloudflare R2 object storage

## Features
- JWT auth: register, login, me, profile update
- Per-user ownership on all scan reads and mutations
- Multipart scan upload with metadata JSON
- Scan list, get, patch, sync, delete, and file download
- Consistent JSON error responses
- Health endpoints at `/api/health` and `/actuator/health`

## Project Layout
- `src/main/java/com/lidarpro/backend/auth`
- `src/main/java/com/lidarpro/backend/security`
- `src/main/java/com/lidarpro/backend/scan`
- `src/main/java/com/lidarpro/backend/storage`
- `src/main/java/com/lidarpro/backend/common`
- `src/main/resources/application.yml`

## Local Run

### Prerequisites
- Java 17+
- Maven 3.9+
- Docker Desktop or another Docker runtime for the local Postgres container

### 1. Configure environment
From `backend/`, create a local env file from the template.

PowerShell:
```powershell
Copy-Item .env.example .env
```

POSIX shell:
```bash
cp .env.example .env
```

Minimum values to set in `.env`:
- `APP_AUTH_JWT_SECRET`
- Either `SPRING_DATASOURCE_URL` or the `DB_*` variables used by your runtime shell
- `APP_STORAGE_PROVIDER=local`
- `APP_STORAGE_ROOT_DIR=./data/storage`
- `APP_STORAGE_PUBLIC_BASE_URL=http://localhost:8080/api/scans`

### 2. Start local Postgres
```bash
docker compose up -d
```

The bundled compose file exposes Postgres on `localhost:5432`.

### 3. Run the backend
```bash
mvn spring-boot:run
```

The app listens on `http://localhost:8080` unless `SERVER_PORT` is overridden.

## Environment

### Database
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `SPRING_DATASOURCE_URL`
- `SPRING_DATASOURCE_USERNAME`
- `SPRING_DATASOURCE_PASSWORD`

### Server
- `SERVER_PORT`

### Auth
- `APP_AUTH_JWT_SECRET`
- `APP_AUTH_ACCESS_TOKEN_MINUTES`
- `APP_AUTH_JWT_ISSUER`
- `APP_AUTH_JWT_AUDIENCE`

### Storage
- `APP_STORAGE_PROVIDER`
- `APP_STORAGE_ROOT_DIR`
- `APP_STORAGE_PUBLIC_BASE_URL`
- `APP_STORAGE_R2_ENDPOINT`
- `APP_STORAGE_R2_ACCOUNT_ID`
- `APP_STORAGE_R2_BUCKET`
- `APP_STORAGE_R2_ACCESS_KEY_ID`
- `APP_STORAGE_R2_SECRET_ACCESS_KEY`
- `APP_STORAGE_R2_REGION`

For Supabase or another managed Postgres provider, prefer setting `SPRING_DATASOURCE_URL` directly. Example:
`jdbc:postgresql://<host>:5432/postgres?sslmode=require`

## API Surface

### Public
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /actuator/health`

### Authenticated
- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `POST /api/scans`
- `GET /api/scans`
- `GET /api/scans/{id}`
- `PATCH /api/scans/{id}`
- `POST /api/scans/{id}/sync`
- `DELETE /api/scans/{id}`
- `GET /api/scans/{id}/file`

## Sample Checks

Register:
```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","fullName":"Demo User","password":"ChangeMe123!"}'
```

Login:
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"ChangeMe123!"}'
```

Get current user:
```bash
curl http://localhost:8080/api/auth/me \
  -H "Authorization: Bearer <access-token>"
```

Upload a scan:
```bash
curl -X POST http://localhost:8080/api/scans \
  -H "Authorization: Bearer <access-token>" \
  -F "file=@/path/to/scan.glb" \
  -F 'metadata={"title":"Living Room","modelFormat":"glb","status":"processed"}'
```

List scans:
```bash
curl http://localhost:8080/api/scans \
  -H "Authorization: Bearer <access-token>"
```

Download a scan file:
```bash
curl http://localhost:8080/api/scans/<scan-id>/file \
  -H "Authorization: Bearer <access-token>" \
  --output scan.glb
```

## Container Build

Build the image from `backend/`:
```bash
docker build -t lidarpro-backend .
```

Run it:
```bash
docker run --rm -p 8080:8080 --env-file .env lidarpro-backend
```

## Deployment Notes
- For local-only storage, mount a persistent volume to the storage root directory.
- For cloud deployment, prefer `APP_STORAGE_PROVIDER=r2` and a managed Postgres database.
- Ensure `APP_STORAGE_PUBLIC_BASE_URL` points to the public API base, for example `https://api.example.com/api/scans`.

## Troubleshooting

### App cannot connect to Postgres
- Verify the datasource URL or `DB_*` values.
- If you are using Docker Compose locally, confirm the container is healthy with `docker compose ps`.

### Auth requests fail with 400 or 500
- Confirm `APP_AUTH_JWT_SECRET` is set.
- Check that the database schema can be created by JPA for the configured datasource.

### File upload returns storage errors
- Ensure `APP_STORAGE_ROOT_DIR` is writable when `APP_STORAGE_PROVIDER=local`.
- Ensure `APP_STORAGE_PUBLIC_BASE_URL` includes `/api/scans` so generated download URLs are correct.

### Cloud deployment fails against local DB settings
- Do not use `localhost` in production datasource URLs.
- Use the managed database host or pooler endpoint instead.

## Related Docs
- Root project readme: [../README.md](../README.md)
