# Spcaial Pro Frontend

React + Vite + Capacitor app for scanning, AI overlays, text recognition, and 3D model viewing.

## Stack
- React 18 + TypeScript
- Vite 5
- Capacitor 8
- Three.js
- TensorFlow.js (`@tensorflow-models/coco-ssd`) for web object detection

## Prerequisites
- Node.js 18+
- npm 9+
- iOS: Xcode (for iOS builds)
- Android: Android Studio + SDK/JDK (for Android builds)

## Setup
```bash
cd frontend
npm install
cp .env.example .env
```

## Environment Variables
`frontend/.env`

- `VITE_API_BASE_URL`: Backend URL (example: `http://localhost:8080`)
- `VITE_OBJECT_DETECTION_BASE`: Web detector model
  - `mobilenet_v1` (best accuracy)
  - `mobilenet_v2` (balanced)
  - `lite_mobilenet_v2` (fastest)

## Run (Web)
```bash
npm run dev
```
App runs at `http://localhost:5173` by default.

## Build (Web)
```bash
npm run build
npm run preview
```

## Type Check
```bash
npm run typecheck
```

## Capacitor Workflow
After frontend code changes that affect the built web bundle:
```bash
npm run build
npx cap sync
```

Platform specific:
```bash
npx cap sync ios
npx cap sync android
```

Open native projects:
```bash
npx cap open ios
npx cap open android
```

## iOS Notes
- Native plugin source is in `ios/App/App/AppDelegate.swift`.
- Object detection payload includes label, confidence, and (when available) world position + distance.
- Text recognition and object detection run through Vision on-device.

## Android Notes
- Native plugin source is in `android/app/src/main/java/com/lidarpro/app/MainActivity.java`.
- ARCore + ML Kit are used for native scanning/object detection/text recognition.
- Native object detection quality mode is wired (`accurate` default, `fast` available).

## Authentication + API
- Auth tokens are stored with Capacitor Preferences on native platforms.
- Frontend expects backend auth endpoints under `/api/auth` and scan endpoints under `/api/scans`.

## Troubleshooting

### Failed to fetch on mobile
- Verify `VITE_API_BASE_URL` points to a reachable HTTPS backend.
- Check backend CORS allows your app origin.
- Rebuild + sync after env changes:
  ```bash
  npm run build
  npx cap sync
  ```

### iOS app not launching (certificate trust)
- On device: `Settings -> General -> VPN & Device Management -> Trust Developer App`.

### Android Gradle issues
- Ensure Android SDK/JDK paths are configured.
- If wrapper download fails, verify network and Gradle proxy settings.

## Key Directories
- `src/pages/`: top-level screens
- `src/services/`: API + scanner services
- `src/hooks/`: scanner/object/text recognition hooks
- `src/components/`: reusable UI + viewer components
- `src/plugins/lidarScanner.ts`: Capacitor plugin interface
