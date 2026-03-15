# Spacial Pro Frontend

React + Vite + Capacitor frontend for auth, scan capture, local scan storage, cloud sync, detection overlays, text recognition, and 3D model viewing.

## Stack
- React 18 + TypeScript
- Vite 5
- Tailwind CSS
- Capacitor 8
- Three.js
- TensorFlow.js + `@tensorflow-models/coco-ssd` for web object detection
- Capacitor Preferences for auth and local scan persistence on native platforms

## Prerequisites
- Node.js 18+
- npm 9+
- iOS workflows: Xcode
- Android workflows: Android Studio with Android SDK and JDK 21

## Setup
```bash
cd frontend
npm install
cp .env.example .env
```

`npm install` also runs a local compatibility patch for `@capacitor-community/camera-preview` so the generated Capacitor 8 iOS package graph resolves cleanly.

## Environment
Environment file: `frontend/.env`

- `VITE_API_BASE_URL=` backend base URL, for example `http://localhost:8080`
- `VITE_OBJECT_DETECTION_BASE=` web detector model
  - `mobilenet_v1`
  - `mobilenet_v2`
  - `lite_mobilenet_v2`

## Web Workflow
Start dev server:
```bash
npm run dev
```

Validate production build:
```bash
npm run typecheck
npm run build
npm run preview
```

## Native Workflow
Create or refresh native assets after web changes:
```bash
npm run build
npx cap sync
```

Open native projects:
```bash
npx cap open ios
npx cap open android
```

Platform notes:
- iOS app-local bridge lives in `ios/App/App/AppDelegate.swift`
- Android app-local bridge lives in `android/app/src/main/java/com/lidarpro/app/MainActivity.java`
- native auth and local scan persistence use Capacitor Preferences

## Route Map
Active routes in the app:

- `/login`
- `/signup`
- `/library`
- `/scan`
- `/preview/:scanId`
- `/viewer/:scanId`

Legacy prompt mapping from `HTML_PAGE_RESOURCES`:

- `/login` -> `HTML_PAGE_RESOURCES/login.html`
- `/signup` -> `HTML_PAGE_RESOURCES/signup.html`
- `/library` -> `HTML_PAGE_RESOURCES/library.html`
- `/scan` -> `HTML_PAGE_RESOURCES/scan.html`
- `/preview/:scanId` -> `HTML_PAGE_RESOURCES/preview.html`
- `/viewer/:scanId` -> `HTML_PAGE_RESOURCES/viewer.html`

The current implementation source of truth is `frontend/src`, not the static HTML files.

## Persistence And Sync
Auth persistence:
- web stores auth in `localStorage`
- native stores auth token and user via Capacitor Preferences
- auth bootstrap happens before protected routes render

Scan persistence:
- scans save locally first
- local scans are stored in `localStorage` on web and Capacitor Preferences on native
- signed-in sessions trigger background sync attempts for unsynced local scans

Viewer persistence:
- annotation edits are saved locally first
- cloud annotation patching is attempted when the scan has a remote id

## Verification Status
Verified in this pass:
- `npm run typecheck`
- `npm run build`
- `npx cap sync`
- iOS simulator build of the generated Capacitor app

Environment-limited in this pass:
- on-device iOS auth persistence
- on-device Android auth persistence
- native scan capture on real LiDAR hardware
- native detection and text-recognition runtime behavior on device

Code paths for those flows are present, but they were not fully device-tested in this workspace session.

## QA Checklist
Auth:
- login redirects to `/library`
- signup redirects to `/library`
- guests are redirected away from protected routes
- authenticated users are redirected away from `/login` and `/signup`

Scan flow:
- scan save creates a local record first
- signed-in sessions attempt background upload for local scans
- library updates after delete and sync actions

Detection and read mode:
- web object detection uses TensorFlow.js
- web text recognition uses `TextDetector` when available
- native bridges expose `objectDetections` and `recognizedText` event channels

Viewer:
- measure mode reports feet distance
- annotate mode saves edits
- edit mode supports hide, undo, and show-all mesh controls
- export/share is available from the viewer header

## Troubleshooting
Backend not reachable:
- verify `VITE_API_BASE_URL`
- make sure backend CORS allows the frontend origin
- rebuild and sync after env changes

```bash
npm run build
npx cap sync
```

iOS package resolution errors mentioning `camera-preview`:
- rerun `npm install`
- confirm the postinstall patch ran
- if needed, rerun `node ./scripts/patch-camera-preview-swift-package.mjs`

Android Gradle issues:
- use Android Studio JDK 21
- verify SDK paths inside Android Studio
- if Gradle wrapper download fails, fix network/proxy access and retry

Native bridge not detected from JS:
- run `npm run build`
- run `npx cap sync`
- reopen the native project after sync

## Key Directories
- `src/pages/` route screens
- `src/components/` reusable UI and viewer components
- `src/hooks/` scanner, library, object-detection, and text-recognition hooks
- `src/services/` auth, scan, scanner, and export services
- `src/plugins/lidarScanner.ts` Capacitor plugin contract used by the TS layer
- `ios/` Capacitor iOS project
- `android/` Capacitor Android project
