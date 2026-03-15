package com.lidarpro.backend.scan;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

@Entity
@Table(name = "scans")
public class ScanEntity {

    @Id
    private UUID id;

    @Column
    private UUID ownerUserId;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(nullable = false, length = 80)
    private String status;

    @Column(nullable = false, length = 80)
    private String syncState;

    @Column(nullable = false, length = 80)
    private String source;

    @Column(nullable = false, length = 80)
    private String storageLocation;

    @Column(length = 120)
    private String arEngine;

    @Column(length = 20)
    private String modelFormat;

    @Column(nullable = false, length = 500)
    private String storagePath;

    @Column(length = 300)
    private String originalFilename;

    @Column(length = 120)
    private String contentType;

    private long fileSizeBytes;

    private Long pointsCaptured;

    private Long vertexCount;

    private Long faceCount;

    private Integer scanQuality;

    private Double estimatedAccuracyMm;

    private Integer frameCount;

    private Double scanDistanceMeters;

    @Column(length = 30)
    private String scanDetailLevel;

    @Column(length = 120)
    private String deviceModel;

    @Column(length = 80)
    private String platform;

    @Column(length = 80)
    private String appVersion;

    private Boolean textureIncluded;

    private Boolean uvEnabled;

    @Column(length = 2048)
    private String cloudModelUrl;

    private Instant cloudSyncedAt;

    private Instant capturedAt;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String annotationsJson;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String aiDetectionsJson;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String frameMetadataSummaryJson;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String extraMetadataJson;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (capturedAt == null) {
            capturedAt = now;
        }
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public UUID getOwnerUserId() {
        return ownerUserId;
    }

    public void setOwnerUserId(UUID ownerUserId) {
        this.ownerUserId = ownerUserId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
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

    public String getStoragePath() {
        return storagePath;
    }

    public void setStoragePath(String storagePath) {
        this.storagePath = storagePath;
    }

    public String getOriginalFilename() {
        return originalFilename;
    }

    public void setOriginalFilename(String originalFilename) {
        this.originalFilename = originalFilename;
    }

    public String getContentType() {
        return contentType;
    }

    public void setContentType(String contentType) {
        this.contentType = contentType;
    }

    public long getFileSizeBytes() {
        return fileSizeBytes;
    }

    public void setFileSizeBytes(long fileSizeBytes) {
        this.fileSizeBytes = fileSizeBytes;
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

    public Instant getCloudSyncedAt() {
        return cloudSyncedAt;
    }

    public void setCloudSyncedAt(Instant cloudSyncedAt) {
        this.cloudSyncedAt = cloudSyncedAt;
    }

    public Instant getCapturedAt() {
        return capturedAt;
    }

    public void setCapturedAt(Instant capturedAt) {
        this.capturedAt = capturedAt;
    }

    public String getAnnotationsJson() {
        return annotationsJson;
    }

    public void setAnnotationsJson(String annotationsJson) {
        this.annotationsJson = annotationsJson;
    }

    public String getAiDetectionsJson() {
        return aiDetectionsJson;
    }

    public void setAiDetectionsJson(String aiDetectionsJson) {
        this.aiDetectionsJson = aiDetectionsJson;
    }

    public String getFrameMetadataSummaryJson() {
        return frameMetadataSummaryJson;
    }

    public void setFrameMetadataSummaryJson(String frameMetadataSummaryJson) {
        this.frameMetadataSummaryJson = frameMetadataSummaryJson;
    }

    public String getExtraMetadataJson() {
        return extraMetadataJson;
    }

    public void setExtraMetadataJson(String extraMetadataJson) {
        this.extraMetadataJson = extraMetadataJson;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
