import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import './index.css';

function installNativeZoomGuards() {
  let lastTouchEndAt = 0;

  const preventGesture = (event: Event) => {
    event.preventDefault();
  };

  const preventPinchZoom = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  };

  const preventDoubleTapZoom = (event: TouchEvent) => {
    const now = Date.now();

    if (now - lastTouchEndAt <= 300) {
      event.preventDefault();
    }

    lastTouchEndAt = now;
  };

  const preventTrackpadZoom = (event: WheelEvent) => {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  };

  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });
  document.addEventListener('touchmove', preventPinchZoom, { passive: false });
  document.addEventListener('touchend', preventDoubleTapZoom, { passive: false });
  document.addEventListener('wheel', preventTrackpadZoom, { passive: false });
}

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-mobile-lock');
  document.body.classList.add('native-mobile-lock');
  installNativeZoomGuards();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);
