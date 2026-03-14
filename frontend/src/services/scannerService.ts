import { Capacitor } from '@capacitor/core';
import { CameraPreview } from '@capacitor-community/camera-preview';
import {
  LidarScanner,
  type CameraPermissionStatus,
  type ObjectDetectionOptions,
  type ScanStartOptions,
  type TextRecognitionOptions,
} from '../plugins/lidarScanner';

type NativeListenerHandle = {
  remove: () => Promise<void>;
};

const NO_LIDAR_MESSAGE = 'No LiDAR on device.';

let webStream: MediaStream | null = null;
let nativePreviewRunning = false;
const previewAny = CameraPreview as unknown as {
  start?: (options: Record<string, unknown>) => Promise<void>;
  stop?: () => Promise<void>;
  checkPermissions?: () => Promise<{ camera?: string }>;
  requestPermissions?: () => Promise<{ camera?: string }>;
};

function setNativePreviewCss(active: boolean) {
  const root = document.documentElement;
  const body = document.body;

  root.classList.toggle('camera-preview-active', active);
  body.classList.toggle('camera-preview-active', active);
}

function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

function isNativeRuntime() {
  return isNativePlatform();
}

function hasNativeLidarPlugin() {
  if (!isNativePlatform()) {
    return false;
  }

  try {
    return Capacitor.isPluginAvailable('LidarScanner');
  } catch {
    return false;
  }
}

function getPlatform() {
  return Capacitor.getPlatform();
}

function getEngineForPlatform(platform: string) {
  if (platform === 'ios') {
    return 'ARKit';
  }

  if (platform === 'android') {
    return 'ARCore';
  }

  return 'Web Mock';
}

function normalizeNativeLidarError(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message.trim() : String(error || '').trim();
  const normalized = message.toLowerCase();

  if (
    normalized.includes('lidarscanner') &&
    (normalized.includes('not implemented') ||
      normalized.includes('not available') ||
      normalized.includes('does not have an implementation') ||
      normalized.includes('unimplemented'))
  ) {
    return new Error(NO_LIDAR_MESSAGE);
  }

  if (normalized.includes('plugin') && normalized.includes('not implemented')) {
    return new Error(NO_LIDAR_MESSAGE);
  }

  if (!message) {
    return new Error(fallbackMessage);
  }

  return error instanceof Error ? error : new Error(message);
}

function defaultCapabilities() {
  const platform = getPlatform();

  return {
    platform,
    arEngine: getEngineForPlatform(platform),
    arSupported: platform !== 'web',
    lidarSupported: false,
    depthApi: platform === 'android' ? 'ARCore Depth' : 'none',
    cameraAvailable: true,
    nativeObjectDetection: false,
    nativeTextRecognition: false,
  };
}

async function ensureNativeCameraPreviewPermission(): Promise<CameraPermissionStatus> {
  if (hasNativeLidarPlugin()) {
    try {
      const permission = await LidarScanner.requestCameraPermission();

      if (permission?.granted) {
        return permission;
      }
    } catch {
      return {
        granted: false,
        status: 'denied',
      };
    }
  }

  if (typeof previewAny.checkPermissions === 'function') {
    const status = await previewAny.checkPermissions();

    if (status?.camera === 'granted') {
      return { granted: true, status: 'granted' };
    }
  }

  if (typeof previewAny.requestPermissions === 'function') {
    const result = await previewAny.requestPermissions();

    return {
      granted: result?.camera === 'granted',
      status: result?.camera || 'denied',
    };
  }

  return { granted: false, status: 'unavailable' };
}

async function startWebCameraStream(webVideoElement?: HTMLVideoElement | null) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API is not available in this browser.');
  }

  if (!webVideoElement) {
    throw new Error('Missing video element for web camera preview.');
  }

  webStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
    },
    audio: false,
  });

  webVideoElement.srcObject = webStream;
  webVideoElement.setAttribute('playsinline', 'true');
  webVideoElement.muted = true;
  await webVideoElement.play();

  return { mode: 'web' as const };
}

export async function getScannerCapabilities() {
  if (isNativePlatform() && !hasNativeLidarPlugin()) {
    return {
      ...defaultCapabilities(),
      arSupported: false,
      depthApi: 'none',
      nativeObjectDetection: false,
      nativeTextRecognition: false,
      lidarSupported: false,
    };
  }

  try {
    return {
      ...defaultCapabilities(),
      ...(await LidarScanner.getCapabilities()),
    };
  } catch {
    return defaultCapabilities();
  }
}

export async function ensureCameraPermission(): Promise<CameraPermissionStatus> {
  if (getPlatform() === 'web') {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { granted: false, status: 'unavailable' };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      return { granted: true, status: 'granted' };
    } catch {
      return { granted: false, status: 'denied' };
    }
  }

  return ensureNativeCameraPreviewPermission();
}

export async function startCameraPreview({
  webVideoElement,
  parentId = 'native-camera-preview',
}: {
  webVideoElement?: HTMLVideoElement | null;
  parentId?: string;
}) {
  const permission = await ensureCameraPermission();

  if (!permission.granted) {
    throw new Error('Camera permission was denied. Please allow camera access in system settings.');
  }

  if (getPlatform() === 'web') {
    return startWebCameraStream(webVideoElement);
  }

  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    await LidarScanner.startPreview();
  } catch (error) {
    if (typeof previewAny.start !== 'function') {
      throw normalizeNativeLidarError(error, 'Failed to start native preview.');
    }

    await previewAny.start({
      parent: parentId,
      className: 'native-camera-layer',
      position: 'rear',
      toBack: true,
      disableAudio: true,
      enableZoom: true,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }

  nativePreviewRunning = true;
  setNativePreviewCss(true);

  return { mode: 'native' as const };
}

export async function stopCameraPreview({ webVideoElement }: { webVideoElement?: HTMLVideoElement | null } = {}) {
  if (webStream) {
    webStream.getTracks().forEach((track) => track.stop());
    webStream = null;
  }

  if (webVideoElement) {
    webVideoElement.srcObject = null;
  }

  if (!nativePreviewRunning) {
    return;
  }

  try {
    if (hasNativeLidarPlugin()) {
      await LidarScanner.stopPreview();
    } else if (typeof previewAny.stop === 'function') {
      await previewAny.stop();
    }
  } finally {
    nativePreviewRunning = false;
    setNativePreviewCss(false);
  }
}

export async function startNativeScan(options: ScanStartOptions = {}) {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.startScan({
      maxDistanceMeters: Number(options.maxDistanceMeters || 5),
      detailLevel: String(options.detailLevel || 'high'),
    });
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to start native scan.');
  }
}

export async function stopNativeScan() {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.stopScan();
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to stop native scan.');
  }
}

export async function getNativeScanStatus() {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.getScanStatus();
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to read native scan status.');
  }
}

export async function exportNativeScan() {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.exportScan();
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to export native scan.');
  }
}

export async function listNativeSavedModels() {
  if (!isNativePlatform() || !hasNativeLidarPlugin()) {
    return [];
  }

  try {
    const result = await LidarScanner.listSavedModels();

    if (Array.isArray(result)) {
      return result;
    }

    if (Array.isArray(result?.models)) {
      return result.models;
    }
  } catch {
    return [];
  }

  return [];
}

export async function startNativeObjectDetection(options: ObjectDetectionOptions = {}) {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.startObjectDetection({
      minConfidence: Number(options.minConfidence || 0.55),
      intervalMs: Number(options.intervalMs || 900),
      qualityMode: options.qualityMode || 'accurate',
    });
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to start native object detection.');
  }
}

export async function stopNativeObjectDetection() {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.stopObjectDetection();
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to stop native object detection.');
  }
}

export async function getNativeObjectDetectionStatus() {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.getObjectDetectionStatus();
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to get native object detection status.');
  }
}

export function addNativeObjectDetectionListener(listener: (event: unknown) => void) {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  return LidarScanner.addListener('objectDetections', listener) as Promise<NativeListenerHandle>;
}

export async function startNativeTextRecognition(options: TextRecognitionOptions = {}) {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.startTextRecognition({
      intervalMs: Number(options.intervalMs || 1100),
    });
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to start native text recognition.');
  }
}

export async function stopNativeTextRecognition() {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.stopTextRecognition();
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to stop native text recognition.');
  }
}

export async function getNativeTextRecognitionStatus() {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  try {
    return await LidarScanner.getTextRecognitionStatus();
  } catch (error) {
    throw normalizeNativeLidarError(error, 'Failed to get native text recognition status.');
  }
}

export function addNativeTextRecognitionListener(listener: (event: unknown) => void) {
  if (!hasNativeLidarPlugin()) {
    throw new Error(NO_LIDAR_MESSAGE);
  }

  return LidarScanner.addListener('recognizedText', listener) as Promise<NativeListenerHandle>;
}

export function getAREngineLabel() {
  return getEngineForPlatform(getPlatform());
}

export const scannerService = {
  getScannerCapabilities,
  ensureCameraPermission,
  startCameraPreview,
  stopCameraPreview,
  startNativeScan,
  stopNativeScan,
  getNativeScanStatus,
  exportNativeScan,
  listNativeSavedModels,
  startNativeObjectDetection,
  stopNativeObjectDetection,
  getNativeObjectDetectionStatus,
  addNativeObjectDetectionListener,
  startNativeTextRecognition,
  stopNativeTextRecognition,
  getNativeTextRecognitionStatus,
  addNativeTextRecognitionListener,
  getAREngineLabel,
  isNativeRuntime,
};
