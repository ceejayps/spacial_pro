# LiDAR Pro

LiDAR Pro is a full-stack 3D scanning app:
- `frontend/`: React + Vite + Capacitor app (web, iOS, Android)
- `backend/`: Spring Boot API (auth, user profile, scan metadata, model upload/stream)

## Repository Layout
- `frontend/`: UI, scanner session, native bridge hooks, viewer
- `backend/`: REST API, JWT auth, PostgreSQL persistence, storage adapters (local + R2)

## Quick Start (Local)

### 1) Backend
```bash
cd backend
cp .env.example .env
# Fill .env values

docker compose up -d   # optional local Postgres
mvn spring-boot:run
```

Backend health:
- `http://localhost:8080/api/health`
- `http://localhost:8080/actuator/health`

### 2) Frontend (Web)
```bash
cd frontend
npm install
cp .env.example .env
# Set VITE_API_BASE_URL
npm run dev
```

Frontend dev URL: `http://localhost:5173`

## Mobile Builds
From `frontend/`:
```bash
npm run build
npx cap sync ios
npx cap sync android
```
Then open in native IDE:
- iOS: `npx cap open ios`
- Android: `npx cap open android`

## Environment Files
- Frontend: `frontend/.env.example`
- Backend: `backend/.env.example`

Do not commit real secrets to git.

## Documentation
- Frontend docs: [frontend/README.md](frontend/README.md)
- Backend docs: [backend/README.md](backend/README.md)
