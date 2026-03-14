package com.lidarpro.backend.scan;

import java.time.Instant;

import com.fasterxml.jackson.databind.JsonNode;

public record ScanResponse(
    String id,
    String title,
    String status,
    String syncState,
    String source,
    String storageLocation,
    String arEngine,
    String modelFormat,
    String modelUrl,
    String fileDownloadUrl,
    String originalFilename,
    String contentType,
    long fileSizeBytes,
    Long pointsCaptured,
    Long vertexCount,
    Long faceCount,
    Integer scanQuality,
    Double estimatedAccuracyMm,
    Integer frameCount,
    Double scanDistanceMeters,
    String scanDetailLevel,
    String deviceModel,
    String platform,
    String appVersion,
    Boolean textureIncluded,
    Boolean uvEnabled,
    String cloudModelUrl,
    Instant cloudSyncedAt,
    Instant capturedAt,
    JsonNode annotations,
    JsonNode aiDetections,
    JsonNode frameMetadataSummary,
    JsonNode extraMetadata,
    Instant createdAt,
    Instant updatedAt
) {
}
