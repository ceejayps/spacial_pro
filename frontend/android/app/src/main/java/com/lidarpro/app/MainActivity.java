package com.lidarpro.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LidarScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

@CapacitorPlugin(
    name = "LidarScanner",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = LidarScannerPlugin.CAMERA_PERMISSION_ALIAS)
    }
)
class LidarScannerPlugin extends Plugin {
    static final String CAMERA_PERMISSION_ALIAS = "camera";

    private boolean previewing = false;
    private boolean scanRunning = false;
    private long scanStartedAtMs = 0L;
    private boolean objectDetectionEnabled = false;
    private boolean textRecognitionEnabled = false;
    private double objectDetectionMinConfidence = 0.55;
    private int objectDetectionIntervalMs = 900;
    private int textRecognitionIntervalMs = 1100;
    private String objectDetectionQualityMode = "accurate";

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        boolean cameraAvailable = getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);

        JSObject result = new JSObject();
        result.put("platform", "android");
        result.put("arEngine", "ARCore");
        result.put("arSupported", false);
        result.put("lidarSupported", false);
        result.put("depthApi", "none");
        result.put("cameraAvailable", cameraAvailable);
        result.put("nativeObjectDetection", cameraAvailable);
        result.put("nativeTextRecognition", cameraAvailable);
        call.resolve(result);
    }

    @PluginMethod
    public void requestCameraPermission(PluginCall call) {
        PermissionState state = getPermissionState(CAMERA_PERMISSION_ALIAS);

        if (state == PermissionState.GRANTED) {
            resolvePermission(call, true, "granted");
            return;
        }

        requestPermissionForAlias(CAMERA_PERMISSION_ALIAS, call, "cameraPermissionCallback");
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (call == null) {
            return;
        }

        PermissionState state = getPermissionState(CAMERA_PERMISSION_ALIAS);
        boolean granted = state == PermissionState.GRANTED;
        String status = granted ? "granted" : state.toString().toLowerCase(Locale.US);
        resolvePermission(call, granted, status);
    }

    @PluginMethod
    public void startPreview(PluginCall call) {
        if (getPermissionState(CAMERA_PERMISSION_ALIAS) != PermissionState.GRANTED) {
            call.reject("Camera permission not granted.");
            return;
        }

        previewing = true;
        JSObject result = new JSObject();
        result.put("previewing", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        previewing = false;
        JSObject result = new JSObject();
        result.put("previewing", false);
        call.resolve(result);
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        call.reject("No LiDAR on device.");
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        scanRunning = false;
        scanStartedAtMs = 0L;
        call.resolve(buildScanStatus());
    }

    @PluginMethod
    public void getScanStatus(PluginCall call) {
        call.resolve(buildScanStatus());
    }

    @PluginMethod
    public void exportScan(PluginCall call) {
        call.reject("No LiDAR on device.");
    }

    @PluginMethod
    public void listSavedModels(PluginCall call) {
        JSArray models = new JSArray();
        File[] files = modelsDirectory().listFiles();

        if (files != null) {
            for (File file : files) {
                if (!file.isFile()) {
                    continue;
                }

                String extension = extensionOf(file.getName());
                if (!"obj".equals(extension) && !"glb".equals(extension) && !"gltf".equals(extension)) {
                    continue;
                }

                JSObject item = new JSObject();
                item.put("id", file.getName().replace('.', '-'));
                item.put("title", file.getName().replaceFirst("\\.[^.]+$", ""));
                item.put("capturedAtMs", file.lastModified());
                item.put("format", extension);
                item.put("fileUrl", Uri.fromFile(file).toString());
                item.put("filePath", file.getAbsolutePath());
                item.put("fileSizeBytes", file.length());
                models.put(item);
            }
        }

        JSObject result = new JSObject();
        result.put("models", models);
        call.resolve(result);
    }

    @PluginMethod
    public void deleteSavedModel(PluginCall call) {
        String filePath = call.getString("filePath", "").trim();

        if (filePath.isEmpty()) {
            call.reject("Model file path is required.");
            return;
        }

        File modelsDirectory = modelsDirectory();
        String targetName = new File(filePath).getName();
        String baseName = targetName.replaceFirst("\\.[^.]+$", "");

        if (baseName.isEmpty()) {
            call.reject("Unable to resolve model file name.");
            return;
        }

        String[] relatedFileNames = new String[] {
            baseName + ".obj",
            baseName + ".gltf",
            baseName + ".glb",
            baseName + ".mtl",
            baseName + "-albedo.jpg",
            baseName + "-normal.jpg"
        };

        boolean deletedAny = false;

        for (String fileName : relatedFileNames) {
            File candidate = new File(modelsDirectory, fileName);

            if (candidate.exists() && candidate.isFile() && candidate.delete()) {
                deletedAny = true;
            }
        }

        JSObject result = new JSObject();
        result.put("deleted", deletedAny);
        result.put("filePath", new File(modelsDirectory, targetName).getAbsolutePath());
        call.resolve(result);
    }

    @PluginMethod
    public void startObjectDetection(PluginCall call) {
        objectDetectionEnabled = true;
        objectDetectionMinConfidence = call.getDouble("minConfidence", 0.55);
        objectDetectionIntervalMs = call.getInt("intervalMs", 900);
        objectDetectionQualityMode = call.getString("qualityMode", "accurate");

        JSObject payload = buildObjectDetectionStatus();
        notifyListeners("objectDetections", payload);
        call.resolve(payload);
    }

    @PluginMethod
    public void stopObjectDetection(PluginCall call) {
        objectDetectionEnabled = false;
        call.resolve(buildObjectDetectionStatus());
    }

    @PluginMethod
    public void getObjectDetectionStatus(PluginCall call) {
        call.resolve(buildObjectDetectionStatus());
    }

    @PluginMethod
    public void startTextRecognition(PluginCall call) {
        textRecognitionEnabled = true;
        textRecognitionIntervalMs = call.getInt("intervalMs", 1100);

        JSObject payload = buildTextRecognitionStatus();
        notifyListeners("recognizedText", payload);
        call.resolve(payload);
    }

    @PluginMethod
    public void stopTextRecognition(PluginCall call) {
        textRecognitionEnabled = false;
        call.resolve(buildTextRecognitionStatus());
    }

    @PluginMethod
    public void getTextRecognitionStatus(PluginCall call) {
        call.resolve(buildTextRecognitionStatus());
    }

    private void resolvePermission(PluginCall call, boolean granted, String status) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        result.put("status", status);
        call.resolve(result);
    }

    private JSObject buildScanStatus() {
        long elapsedMs = scanRunning ? SystemClock.elapsedRealtime() - scanStartedAtMs : 0L;
        int pointsCaptured = scanRunning ? (int) Math.min(5000, elapsedMs / 4L) : 0;

        JSObject result = new JSObject();
        result.put("running", scanRunning);
        result.put("pointsCaptured", pointsCaptured);
        result.put("trianglesCaptured", pointsCaptured / 2);
        result.put("anchorCount", 0);
        result.put("elapsedMs", elapsedMs);
        result.put("progress", scanRunning ? Math.min(100, pointsCaptured / 50) : 0);
        return result;
    }

    private JSObject buildObjectDetectionStatus() {
        JSObject result = new JSObject();
        result.put("enabled", objectDetectionEnabled);
        result.put("minConfidence", objectDetectionMinConfidence);
        result.put("intervalMs", objectDetectionIntervalMs);
        result.put("qualityMode", objectDetectionQualityMode);
        result.put("detections", new JSArray());
        result.put("labels", new JSArray());
        result.put("updatedAtMs", System.currentTimeMillis());
        return result;
    }

    private JSObject buildTextRecognitionStatus() {
        JSObject result = new JSObject();
        result.put("enabled", textRecognitionEnabled);
        result.put("intervalMs", textRecognitionIntervalMs);
        result.put("text", "");
        result.put("blocks", new JSArray());
        result.put("updatedAtMs", System.currentTimeMillis());
        return result;
    }

    private File modelsDirectory() {
        File directory = new File(getContext().getFilesDir(), "models");
        if (!directory.exists()) {
            directory.mkdirs();
        }
        return directory;
    }

    private String extensionOf(String filename) {
        int dotIndex = filename.lastIndexOf('.');
        if (dotIndex < 0 || dotIndex >= filename.length() - 1) {
            return "";
        }
        return filename.substring(dotIndex + 1).toLowerCase(Locale.US);
    }
}
