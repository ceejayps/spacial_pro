package com.lidarpro.backend.scan;

import java.time.Instant;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lidarpro.backend.common.NotFoundException;
import com.lidarpro.backend.common.StorageException;
import com.lidarpro.backend.config.StorageProperties;
import com.lidarpro.backend.storage.BinaryStorageService;
import com.lidarpro.backend.storage.StoredObject;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

@Service
@Transactional
public class ScanService {

    private static final Set<String> ALLOWED_MODEL_EXTENSIONS = new HashSet<>(
        Arrays.asList("glb", "gltf", "obj", "stl", "ply", "usdz")
    );
    private static final int MAX_METADATA_JSON_CHARS = 1_000_000;

    private final ScanRepository scanRepository;
    private final BinaryStorageService binaryStorageService;
    private final ObjectMapper objectMapper;
    private final StorageProperties storageProperties;

    public ScanService(
        ScanRepository scanRepository,
        BinaryStorageService binaryStorageService,
        ObjectMapper objectMapper,
        StorageProperties storageProperties
    ) {
        this.scanRepository = scanRepository;
        this.binaryStorageService = binaryStorageService;
        this.objectMapper = objectMapper;
        this.storageProperties = storageProperties;
    }

    public ScanResponse create(UUID ownerUserId, MultipartFile file, String metadataJson) {
        validateIncomingModelFile(file);
        CreateScanMetadataRequest metadata = parseCreateMetadata(metadataJson);

        String namespace = StringUtils.hasText(metadata.getTitle()) ? metadata.getTitle() : "scan";
        StoredObject stored = binaryStorageService.save(file, namespace);

        ScanEntity entity = new ScanEntity();
        entity.setOwnerUserId(ownerUserId);
        entity.setTitle(StringUtils.hasText(metadata.getTitle()) ? metadata.getTitle().trim() : defaultTitle(file));
        entity.setStatus(defaultString(metadata.getStatus(), "processed"));
        entity.setSyncState(defaultString(metadata.getSyncState(), "local"));
        entity.setSource(defaultString(metadata.getSource(), "device"));
        entity.setStorageLocation(defaultString(metadata.getStorageLocation(), "device"));
        entity.setArEngine(defaultString(metadata.getArEngine(), "unknown"));
        entity.setModelFormat(defaultModelFormat(metadata.getModelFormat(), stored.originalFilename()));

        entity.setStoragePath(stored.storagePath());
        entity.setOriginalFilename(stored.originalFilename());
        entity.setContentType(defaultString(stored.contentType(), "application/octet-stream"));
        entity.setFileSizeBytes(stored.sizeBytes());

        entity.setPointsCaptured(metadata.getPointsCaptured());
        entity.setVertexCount(metadata.getVertexCount());
        entity.setFaceCount(metadata.getFaceCount());
        entity.setScanQuality(metadata.getScanQuality());
        entity.setEstimatedAccuracyMm(metadata.getEstimatedAccuracyMm());
        entity.setFrameCount(metadata.getFrameCount());
        entity.setScanDistanceMeters(metadata.getScanDistanceMeters());
        entity.setScanDetailLevel(metadata.getScanDetailLevel());
        entity.setDeviceModel(metadata.getDeviceModel());
        entity.setPlatform(metadata.getPlatform());
        entity.setAppVersion(metadata.getAppVersion());
        entity.setTextureIncluded(metadata.getTextureIncluded());
        entity.setUvEnabled(metadata.getUvEnabled());

        entity.setCloudModelUrl(metadata.getCloudModelUrl());
        entity.setCloudSyncedAt(parseInstant(metadata.getCloudSyncedAt(), null));
        entity.setCapturedAt(parseInstant(metadata.getCapturedAt(), Instant.now()));

        entity.setAnnotationsJson(toJson(metadata.getAnnotations()));
        entity.setAiDetectionsJson(toJson(metadata.getAiDetections()));
        entity.setFrameMetadataSummaryJson(toJson(metadata.getFrameMetadataSummary()));
        entity.setExtraMetadataJson(toJson(metadata.getExtraMetadata()));

        ScanEntity saved = scanRepository.save(entity);
        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public List<ScanResponse> list(UUID ownerUserId) {
        return scanRepository.findAllByOwnerUserIdOrderByCreatedAtDesc(ownerUserId).stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public ScanResponse getById(UUID ownerUserId, String id) {
        return toResponse(getEntity(ownerUserId, id));
    }

    public ScanResponse update(UUID ownerUserId, String id, UpdateScanMetadataRequest request) {
        ScanEntity entity = getEntity(ownerUserId, id);

        if (StringUtils.hasText(request.getTitle())) {
            entity.setTitle(request.getTitle().trim());
        }
        if (StringUtils.hasText(request.getStatus())) {
            entity.setStatus(request.getStatus().trim());
        }
        if (StringUtils.hasText(request.getSyncState())) {
            entity.setSyncState(request.getSyncState().trim());
        }
        if (StringUtils.hasText(request.getCloudModelUrl())) {
            entity.setCloudModelUrl(request.getCloudModelUrl().trim());
        }
        if (StringUtils.hasText(request.getCloudSyncedAt())) {
            entity.setCloudSyncedAt(parseInstant(request.getCloudSyncedAt(), entity.getCloudSyncedAt()));
        }

        if (request.getTextureIncluded() != null) {
            entity.setTextureIncluded(request.getTextureIncluded());
        }
        if (request.getUvEnabled() != null) {
            entity.setUvEnabled(request.getUvEnabled());
        }
        if (request.getAnnotations() != null) {
            entity.setAnnotationsJson(toJson(request.getAnnotations()));
        }
        if (request.getAiDetections() != null) {
            entity.setAiDetectionsJson(toJson(request.getAiDetections()));
        }
        if (request.getFrameMetadataSummary() != null) {
            entity.setFrameMetadataSummaryJson(toJson(request.getFrameMetadataSummary()));
        }
        if (request.getExtraMetadata() != null) {
            entity.setExtraMetadataJson(toJson(request.getExtraMetadata()));
        }

        return toResponse(scanRepository.save(entity));
    }

    public ScanResponse markSynced(UUID ownerUserId, String id, SyncScanRequest request) {
        ScanEntity entity = getEntity(ownerUserId, id);
        entity.setSyncState("synced");
        entity.setStorageLocation("cloud");

        if (request != null && StringUtils.hasText(request.getCloudModelUrl())) {
            entity.setCloudModelUrl(request.getCloudModelUrl().trim());
        }

        entity.setCloudSyncedAt(Instant.now());
        return toResponse(scanRepository.save(entity));
    }

    public void delete(UUID ownerUserId, String id) {
        ScanEntity entity = getEntity(ownerUserId, id);
        binaryStorageService.delete(entity.getStoragePath());
        scanRepository.delete(entity);
    }

    @Transactional(readOnly = true)
    public ScanFileDownload readModelFile(UUID ownerUserId, String id) {
        ScanEntity entity = getEntity(ownerUserId, id);
        return new ScanFileDownload(
            binaryStorageService.loadAsResource(entity.getStoragePath()),
            defaultString(entity.getContentType(), "application/octet-stream"),
            defaultString(entity.getOriginalFilename(), entity.getId() + "." + entity.getModelFormat())
        );
    }

    private ScanEntity getEntity(UUID ownerUserId, String id) {
        UUID uuid = parseUuid(id);
        return scanRepository.findByIdAndOwnerUserId(uuid, ownerUserId)
            .orElseThrow(() -> new NotFoundException("Scan not found: " + id));
    }

    private UUID parseUuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (Exception ex) {
            throw new IllegalArgumentException("Invalid scan id.");
        }
    }

    private CreateScanMetadataRequest parseCreateMetadata(String metadataJson) {
        if (!StringUtils.hasText(metadataJson)) {
            return new CreateScanMetadataRequest();
        }

        if (metadataJson.length() > MAX_METADATA_JSON_CHARS) {
            throw new IllegalArgumentException("metadata payload is too large.");
        }

        try {
            return objectMapper.readValue(metadataJson, CreateScanMetadataRequest.class);
        } catch (JsonProcessingException ex) {
            throw new IllegalArgumentException("metadata must be a valid JSON object.");
        }
    }

    private ScanResponse toResponse(ScanEntity entity) {
        String fileUrl = "%s/%s/file".formatted(storageProperties.getPublicBaseUrl(), entity.getId());
        String modelUrl = StringUtils.hasText(entity.getCloudModelUrl()) ? entity.getCloudModelUrl() : fileUrl;

        return new ScanResponse(
            entity.getId().toString(),
            entity.getTitle(),
            entity.getStatus(),
            entity.getSyncState(),
            entity.getSource(),
            entity.getStorageLocation(),
            entity.getArEngine(),
            entity.getModelFormat(),
            modelUrl,
            fileUrl,
            entity.getOriginalFilename(),
            entity.getContentType(),
            entity.getFileSizeBytes(),
            entity.getPointsCaptured(),
            entity.getVertexCount(),
            entity.getFaceCount(),
            entity.getScanQuality(),
            entity.getEstimatedAccuracyMm(),
            entity.getFrameCount(),
            entity.getScanDistanceMeters(),
            entity.getScanDetailLevel(),
            entity.getDeviceModel(),
            entity.getPlatform(),
            entity.getAppVersion(),
            entity.getTextureIncluded(),
            entity.getUvEnabled(),
            entity.getCloudModelUrl(),
            entity.getCloudSyncedAt(),
            entity.getCapturedAt(),
            readJson(entity.getAnnotationsJson()),
            readJson(entity.getAiDetectionsJson()),
            readJson(entity.getFrameMetadataSummaryJson()),
            readJson(entity.getExtraMetadataJson()),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }

    private JsonNode readJson(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }

        try {
            return objectMapper.readTree(value);
        } catch (JsonProcessingException ex) {
            throw new StorageException("Stored metadata is corrupt.", ex);
        }
    }

    private String toJson(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }

        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException ex) {
            throw new IllegalArgumentException("Invalid metadata JSON value.");
        }
    }

    private Instant parseInstant(String value, Instant fallback) {
        if (!StringUtils.hasText(value)) {
            return fallback;
        }

        try {
            return Instant.parse(value.trim());
        } catch (Exception ex) {
            throw new IllegalArgumentException("Invalid ISO-8601 timestamp: " + value);
        }
    }

    private String defaultTitle(MultipartFile file) {
        String filename = StringUtils.hasText(file.getOriginalFilename()) ? file.getOriginalFilename() : "Scan";
        return "Scan %s (%s)".formatted(filename, Instant.now());
    }

    private String defaultModelFormat(String explicit, String filename) {
        if (StringUtils.hasText(explicit)) {
            return explicit.trim().toLowerCase(Locale.ROOT);
        }

        if (StringUtils.hasText(filename)) {
            int idx = filename.lastIndexOf('.');
            if (idx > -1 && idx < filename.length() - 1) {
                return filename.substring(idx + 1).toLowerCase(Locale.ROOT);
            }
        }

        return "glb";
    }

    private String defaultString(String value, String fallback) {
        return StringUtils.hasText(value) ? value.trim() : fallback;
    }

    private void validateIncomingModelFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Model file is required.");
        }

        String filename = String.valueOf(file.getOriginalFilename()).trim();
        int idx = filename.lastIndexOf('.');
        if (idx < 0 || idx == filename.length() - 1) {
            throw new IllegalArgumentException("Model file must include a valid extension.");
        }

        String extension = filename.substring(idx + 1).toLowerCase(Locale.ROOT);
        if (!ALLOWED_MODEL_EXTENSIONS.contains(extension)) {
            throw new IllegalArgumentException("Unsupported model file type.");
        }
    }
}
