package com.lidarpro.backend.scan;

import com.fasterxml.jackson.databind.JsonNode;

public class UpdateScanMetadataRequest {

    private String title;
    private String status;
    private String syncState;
    private String cloudModelUrl;
    private String cloudSyncedAt;
    private Boolean textureIncluded;
    private Boolean uvEnabled;
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
