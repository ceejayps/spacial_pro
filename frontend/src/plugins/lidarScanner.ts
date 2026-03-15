import { WebPlugin, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type ScannerCapabilities = {
  platform: string;
  arEngine: string;
  arSupported: boolean;
  lidarSupported: boolean;
  depthApi: string;
  cameraAvailable: boolean;
  nativeObjectDetection?: boolean;
  nativeTextRecognition?: boolean;
};

export type CameraPermissionStatus = {
  granted: boolean;
  status: string;
};

export type ScanStartOptions = {
  maxDistanceMeters?: number;
  detailLevel?: string;
};

export type ScanStatus = {
  running: boolean;
  pointsCaptured?: number;
  trianglesCaptured?: number;
  anchorCount?: number;
  elapsedMs?: number;
  progress?: number;
};

export type ScanExportResult = {
  format: string;
  fileUrl: string;
  filePath: string;
  vertexCount: number;
  faceCount: number;
};

export type SavedModelList = {
  models: unknown[];
};

export type DeleteSavedModelOptions = {
  filePath: string;
};

export type DeleteSavedModelResult = {
  deleted: boolean;
  filePath: string;
};

export type ObjectDetectionOptions = {
  minConfidence?: number;
  intervalMs?: number;
  qualityMode?: 'fast' | 'accurate' | 'balanced' | 'stream' | 'single_image';
};

export type ObjectDetectionStatus = {
  enabled: boolean;
  minConfidence?: number;
  intervalMs?: number;
  qualityMode?: string;
  detections: unknown[];
  labels: string[];
  updatedAtMs: number;
};

export type TextRecognitionOptions = {
  intervalMs?: number;
};

export type TextRecognitionStatus = {
  enabled: boolean;
  intervalMs?: number;
  text: string;
  blocks: unknown[];
  updatedAtMs: number;
};

export interface LidarScannerPlugin {
  getCapabilities: () => Promise<ScannerCapabilities>;
  requestCameraPermission: () => Promise<CameraPermissionStatus>;
  startPreview: () => Promise<{ previewing: boolean }>;
  stopPreview: () => Promise<{ previewing: boolean }>;
  startScan: (options?: ScanStartOptions) => Promise<ScanStatus>;
  stopScan: () => Promise<ScanStatus>;
  getScanStatus: () => Promise<ScanStatus>;
  exportScan: () => Promise<ScanExportResult>;
  listSavedModels: () => Promise<SavedModelList | unknown[]>;
  deleteSavedModel: (options: DeleteSavedModelOptions) => Promise<DeleteSavedModelResult>;
  startObjectDetection: (options?: ObjectDetectionOptions) => Promise<ObjectDetectionStatus>;
  stopObjectDetection: () => Promise<ObjectDetectionStatus>;
  getObjectDetectionStatus: () => Promise<ObjectDetectionStatus>;
  startTextRecognition: (options?: TextRecognitionOptions) => Promise<TextRecognitionStatus>;
  stopTextRecognition: () => Promise<TextRecognitionStatus>;
  getTextRecognitionStatus: () => Promise<TextRecognitionStatus>;
  addListener: (
    eventName: 'objectDetections' | 'recognizedText',
    listener: (event: unknown) => void,
  ) => Promise<PluginListenerHandle>;
}

class LidarScannerWeb extends WebPlugin implements LidarScannerPlugin {
  private running = false;
  private startedAt = 0;
  private objectDetectionEnabled = false;
  private textRecognitionEnabled = false;

  async getCapabilities() {
    return {
      platform: 'web',
      arEngine: 'Web Mock',
      arSupported: false,
      lidarSupported: false,
      depthApi: 'none',
      cameraAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
      nativeObjectDetection: false,
      nativeTextRecognition: false,
    };
  }

  async requestCameraPermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return {
        granted: false,
        status: 'unavailable',
      };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());

      return {
        granted: true,
        status: 'granted',
      };
    } catch {
      return {
        granted: false,
        status: 'denied',
      };
    }
  }

  async startPreview() {
    return { previewing: true };
  }

  async stopPreview() {
    return { previewing: false };
  }

  async startScan(options: ScanStartOptions = {}) {
    this.running = true;
    this.startedAt = Date.now();

    return {
      running: true,
      progress: 0,
      pointsCaptured: 0,
      trianglesCaptured: 0,
      anchorCount: 0,
      elapsedMs: 0,
      maxDistanceMeters: Number(options.maxDistanceMeters || 5),
      detailLevel: String(options.detailLevel || 'high'),
    } as ScanStatus;
  }

  async stopScan() {
    this.running = false;
    return { running: false };
  }

  async getScanStatus() {
    const elapsedMs = this.running ? Date.now() - this.startedAt : 0;
    const pointsCaptured = Math.floor(elapsedMs / 3);

    return {
      running: this.running,
      pointsCaptured,
      trianglesCaptured: Math.floor(pointsCaptured / 2),
      anchorCount: 0,
      elapsedMs,
      progress: Math.min(100, pointsCaptured / 5000),
    };
  }

  async exportScan() {
    return {
      format: 'obj',
      fileUrl: '',
      filePath: '',
      vertexCount: 0,
      faceCount: 0,
    };
  }

  async listSavedModels() {
    return { models: [] };
  }

  async deleteSavedModel(options: DeleteSavedModelOptions) {
    return {
      deleted: false,
      filePath: String(options?.filePath || ''),
    };
  }

  async startObjectDetection(options: ObjectDetectionOptions = {}) {
    this.objectDetectionEnabled = true;

    return {
      enabled: true,
      minConfidence: Number(options.minConfidence || 0.55),
      intervalMs: Number(options.intervalMs || 900),
      qualityMode: String(options.qualityMode || 'accurate'),
      detections: [],
      labels: [],
      updatedAtMs: Date.now(),
    };
  }

  async stopObjectDetection() {
    this.objectDetectionEnabled = false;

    return {
      enabled: false,
      detections: [],
      labels: [],
      updatedAtMs: Date.now(),
    };
  }

  async getObjectDetectionStatus() {
    return {
      enabled: this.objectDetectionEnabled,
      detections: [],
      labels: [],
      updatedAtMs: Date.now(),
    };
  }

  async startTextRecognition(options: TextRecognitionOptions = {}) {
    this.textRecognitionEnabled = true;

    return {
      enabled: true,
      intervalMs: Number(options.intervalMs || 1100),
      text: '',
      blocks: [],
      updatedAtMs: Date.now(),
    };
  }

  async stopTextRecognition() {
    this.textRecognitionEnabled = false;

    return {
      enabled: false,
      text: '',
      blocks: [],
      updatedAtMs: Date.now(),
    };
  }

  async getTextRecognitionStatus() {
    return {
      enabled: this.textRecognitionEnabled,
      text: '',
      blocks: [],
      updatedAtMs: Date.now(),
    };
  }
}

export const LidarScanner = registerPlugin<LidarScannerPlugin>('LidarScanner', {
  web: () => new LidarScannerWeb(),
});
