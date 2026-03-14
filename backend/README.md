# LiDAR Pro Backend

Spring Boot API for authentication, user profile, scan metadata, model upload, and model file delivery.

## Stack
- Java 17
- Spring Boot 3.3.x
- Spring Web + Validation
- Spring Data JPA (Hibernate)
- PostgreSQL
- Storage adapters:
  - Local filesystem
  - Cloudflare R2 (S3-compatible)

## Main Features
- JWT auth (`register`, `login`, `me`)
- Per-user data isolation (users can only access their own models/metadata)
- Scan metadata CRUD
- Multipart model upload + model download streaming
- Health endpoints

## Project Structure
- `src/main/java/com/lidarpro/backend/auth`: auth requests/responses/services
- `src/main/java/com/lidarpro/backend/security`: JWT + security filters/config
- `src/main/java/com/lidarpro/backend/scan`: scan entity/repository/controller/service
- `src/main/java/com/lidarpro/backend/config`: app/storage config
- `src/main/resources/application.yml`: runtime configuration

## Prerequisites
- Java 17+
- Maven 3.9+
- PostgreSQL (local container, Supabase, or managed DB)

## Local Setup

### 1) Configure environment
```bash
cd backend
cp .env.example .env
```
Set required values in `.env`.

### 2) Start local Postgres (optional)
```bash
docker compose up -d
```

### 3) Run backend
```bash
mvn spring-boot:run
```

Default port: `8080`

## Health Checks
- `GET /api/health`
- `GET /actuator/health`

## Environment Variables

### Database
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

Optional explicit datasource override:
- `SPRING_DATASOURCE_URL`
- `SPRING_DATASOURCE_USERNAME`
- `SPRING_DATASOURCE_PASSWORD`

For Supabase pooler, use SSL in URL, for example:
`jdbc:postgresql://<pooler-host>:5432/postgres?sslmode=require`

### Server
- `SERVER_PORT` (default `8080`)

### Storage
- `APP_STORAGE_PROVIDER` (`local` or `r2`)
- `APP_STORAGE_ROOT_DIR` (local storage path)
- `APP_STORAGE_PUBLIC_BASE_URL`

R2 settings:
- `APP_STORAGE_R2_ENDPOINT`
- `APP_STORAGE_R2_ACCOUNT_ID`
- `APP_STORAGE_R2_BUCKET`
- `APP_STORAGE_R2_ACCESS_KEY_ID`
- `APP_STORAGE_R2_SECRET_ACCESS_KEY`
- `APP_STORAGE_R2_REGION` (usually `auto`)

### Auth / JWT
- `APP_AUTH_JWT_SECRET`
- `APP_AUTH_ACCESS_TOKEN_MINUTES`
- `APP_AUTH_JWT_ISSUER`
- `APP_AUTH_JWT_AUDIENCE`

## API Summary

Base path: `/api`

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PATCH /api/auth/me`

### Scans (JWT required)
- `POST /api/scans` (multipart upload)
- `GET /api/scans`
- `GET /api/scans/{id}`
- `PATCH /api/scans/{id}`
- `POST /api/scans/{id}/sync`
- `DELETE /api/scans/{id}`
- `GET /api/scans/{id}/file`

## Upload Example
```bash
curl -X POST http://localhost:8080/api/scans \
  -H "Authorization: Bearer <access-token>" \
  -F "file=@/path/to/scan.glb" \
  -F 'metadata={"title":"Living Room","modelFormat":"glb","status":"processed"}'
```

## Deployment (DigitalOcean App Platform)

### Recommended setup
- Backend: DigitalOcean App Platform service
- Database: Supabase Postgres or DigitalOcean managed Postgres
- Model files: Cloudflare R2 bucket

### Steps
1. Push repo to GitHub.
2. Create App Platform app from repo (`backend/` as build context).
3. Set HTTP port `8080`.
4. Add environment variables from your `.env` (as encrypted secrets where appropriate).
5. Deploy and verify `/api/health`.

## Security Baseline
- BCrypt password hashing
- JWT signature + issuer/audience validation
- Ownership checks on scan data
- Upload extension restrictions for model files

## Troubleshooting

### `Connection to localhost:5432 refused` in cloud
Your app is using local DB host in production.
Use managed DB host/pooler (not `localhost`) in `SPRING_DATASOURCE_URL`.

### `NoRouteToHost` to Supabase
Usually wrong host/port or wrong network mode.
Use Supabase pooler endpoint and SSL mode.

### Auth returns 500/400 unexpectedly
- Check DB migrations/schema and datasource env vars.
- Check `APP_AUTH_JWT_SECRET` exists.

### R2 upload failures
- Validate key/secret/bucket/account endpoint values.
- Confirm token has read/write permissions for bucket.

## Related Docs
- Root overview: [../README.md](../README.md)
- Frontend docs: [../frontend/README.md](../frontend/README.md)
