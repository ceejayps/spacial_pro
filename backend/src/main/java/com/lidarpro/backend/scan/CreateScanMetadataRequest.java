package com.lidarpro.backend.scan;

import com.fasterxml.jackson.databind.JsonNode;

public class CreateScanMetadataRequest {

    private String title;
    private String capturedAt;
    private String arEngine;
    private String modelFormat;
    private String status;
    private String syncState;
    private String source;
    private String storageLocation;
    private Long pointsCaptured;
    private Long vertexCount;
    private Long faceCount;
    private Integer scanQuality;
    private Double estimatedAccuracyMm;
    private Integer frameCount;
    private Double scanDistanceMeters;
    private String scanDetailLevel;
    private String deviceModel;
    private String platform;
    private String appVersion;
    private Boolean textureIncluded;
    private Boolean uvEnabled;
    private String cloudModelUrl;
    private String cloudSyncedAt;
    private JsonNode annotations;
    private JsonNode aiDetections;
    private JsonNode frameMetadataSummary;
    private JsonNode extraMetadata;

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getCapturedAt() {
        return capturedAt;
    }

    public void setCapturedAt(String capturedAt) {
        this.capturedAt = capturedAt;
    }

    public String getArEngine() {
        return arEngine;
    }

    public void setArEngine(String arEngine) {
        this.arEngine = arEngine;
    }

    public String getModelFormat() {
        return modelFormat;
    }

    public void setModelFormat(String modelFormat) {
        this.modelFormat = modelFormat;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getSyncState() {
        return syncState;
    }

    public void setSyncState(String syncState) {
        this.syncState = syncState;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getStorageLocation() {
        return storageLocation;
    }

    public void setStorageLocation(String storageLocation) {
        this.storageLocation = storageLocation;
    }

    public Long getPointsCaptured() {
        return pointsCaptured;
    }

    public void setPointsCaptured(Long pointsCaptured) {
        this.pointsCaptured = pointsCaptured;
    }

    public Long getVertexCount() {
        return vertexCount;
    }

    public void setVertexCount(Long vertexCount) {
        this.vertexCount = vertexCount;
    }

    public Long getFaceCount() {
        return faceCount;
    }

    public void setFaceCount(Long faceCount) {
        this.faceCount = faceCount;
    }

    public Integer getScanQuality() {
        return scanQuality;
    }

    public void setScanQuality(Integer scanQuality) {
        this.scanQuality = scanQuality;
    }

    public Double getEstimatedAccuracyMm() {
        return estimatedAccuracyMm;
    }

    public void setEstimatedAccuracyMm(Double estimatedAccuracyMm) {
        this.estimatedAccuracyMm = estimatedAccuracyMm;
    }

    public Integer getFrameCount() {
        return frameCount;
    }

    public void setFrameCount(Integer frameCount) {
        this.frameCount = frameCount;
    }

    public Double getScanDistanceMeters() {
        return scanDistanceMeters;
    }

    public void setScanDistanceMeters(Double scanDistanceMeters) {
        this.scanDistanceMeters = scanDistanceMeters;
    }

    public String getScanDetailLevel() {
        return scanDetailLevel;
    }

    public void setScanDetailLevel(String scanDetailLevel) {
        this.scanDetailLevel = scanDetailLevel;
    }

    public String getDeviceModel() {
        return deviceModel;
    }

    public void setDeviceModel(String deviceModel) {
        this.deviceModel = deviceModel;
    }

    public String getPlatform() {
        return platform;
    }

    public void setPlatform(String platform) {
        this.platform = platform;
    }

    public String getAppVersion() {
        return appVersion;
    }

    public void setAppVersion(String appVersion) {
        this.appVersion = appVersion;
    }

    public Boolean getTextureIncluded() {
        return textureIncluded;
    }

    public void setTextureIncluded(Boolean textureIncluded) {
        this.textureIncluded = textureIncluded;
    }

    public Boolean getUvEnabled() {
        return uvEnabled;
    }

    public void setUvEnabled(Boolean uvEnabled) {
        this.uvEnabled = uvEnabled;
    }

    public String getCloudModelUrl() {
        return cloudModelUrl;
    }

    public void setCloudModelUrl(String cloudModelUrl) {
        this.cloudModelUrl = cloudModelUrl;
    }

    public String getCloudSyncedAt() {
        return cloudSyncedAt;
    }

    public void setCloudSyncedAt(String cloudSyncedAt) {
        this.cloudSyncedAt = cloudSyncedAt;
    }

    public JsonNode getAnnotations() {
        return annotations;
    }

    public void setAnnotations(JsonNode annotations) {
        this.annotations = annotations;
    }

    public JsonNode getAiDetections() {
        return aiDetections;
    }

    public void setAiDetections(JsonNode aiDetections) {
        this.aiDetections = aiDetections;
    }

    public JsonNode getFrameMetadataSummary() {
        return frameMetadataSummary;
    }

    public void setFrameMetadataSummary(JsonNode frameMetadataSummary) {
        this.frameMetadataSummary = frameMetadataSummary;
    }

    public JsonNode getExtraMetadata() {
        return extraMetadata;
    }

    public void setExtraMetadata(JsonNode extraMetadata) {
        this.extraMetadata = extraMetadata;
    }
}
