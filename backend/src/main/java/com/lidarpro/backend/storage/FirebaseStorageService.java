package com.lidarpro.backend.storage;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.Channels;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.ReadChannel;
import com.google.cloud.storage.Blob;
import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageException;
import com.google.cloud.storage.StorageOptions;
import com.lidarpro.backend.common.NotFoundException;
import com.lidarpro.backend.config.StorageProperties;

import jakarta.annotation.PostConstruct;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

@Service
@ConditionalOnProperty(prefix = "app.storage", name = "provider", havingValue = "firebase")
public class FirebaseStorageService implements BinaryStorageService {

    private static final Logger log = LoggerFactory.getLogger(FirebaseStorageService.class);
    private static final List<String> STORAGE_SCOPES = List.of("https://www.googleapis.com/auth/devstorage.read_write");

    private final StorageProperties storageProperties;
    private Storage storage;
    private String bucket;
    private String projectId;

    public FirebaseStorageService(StorageProperties storageProperties) {
        this.storageProperties = storageProperties;
    }

    @PostConstruct
    void init() {
        this.projectId = require(
            storageProperties.getFirebaseProjectId(),
            "APP_STORAGE_FIREBASE_PROJECT_ID is required when provider=firebase."
        );
        this.bucket = require(
            storageProperties.getFirebaseBucket(),
            "APP_STORAGE_FIREBASE_BUCKET is required when provider=firebase."
        );
        log.info("storage_firebase_initialized projectId={} bucket={}", projectId, bucket);
    }

    @Override
    public StoredObject save(MultipartFile file, String namespace) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Model file is required.");
        }

        String ext = extension(file.getOriginalFilename());
        String safeNamespace = StringUtils.hasText(namespace) ? slug(namespace) : "scan";
        String key = safeNamespace + "/" + UUID.randomUUID() + ext;
        String contentType = StringUtils.hasText(file.getContentType()) ? file.getContentType() : "application/octet-stream";
        BlobInfo blobInfo = BlobInfo.newBuilder(BlobId.of(bucket, key))
            .setContentType(contentType)
            .build();

        try (InputStream inputStream = file.getInputStream()) {
            storage().createFrom(blobInfo, inputStream);
            log.info("storage_firebase_save bucket={} key={} filename={} sizeBytes={}", bucket, key, file.getOriginalFilename(), file.getSize());
            return new StoredObject(key, file.getOriginalFilename(), contentType, file.getSize());
        } catch (IOException ex) {
            throw new com.lidarpro.backend.common.StorageException("Unable to read model file stream.", ex);
        } catch (StorageException ex) {
            throw new com.lidarpro.backend.common.StorageException("Unable to upload model file to Firebase Storage.", ex);
        }
    }

    @Override
    public Resource loadAsResource(String storagePath) {
        String key = require(storagePath, "Storage path is required.");

        try {
            Blob blob = storage().get(BlobId.of(bucket, key));
            if (blob == null || !blob.exists()) {
                throw new NotFoundException("Stored model file not found.");
            }

            ReadChannel channel = blob.reader();
            log.info("storage_firebase_load bucket={} key={}", bucket, key);
            return new InputStreamResource(Channels.newInputStream(channel));
        } catch (StorageException ex) {
            if (ex.getCode() == 404) {
                throw new NotFoundException("Stored model file not found.");
            }
            throw new com.lidarpro.backend.common.StorageException("Unable to read model file from Firebase Storage.", ex);
        }
    }

    @Override
    public void delete(String storagePath) {
        String key = require(storagePath, "Storage path is required.");

        try {
            storage().delete(BlobId.of(bucket, key));
            log.info("storage_firebase_delete bucket={} key={}", bucket, key);
        } catch (StorageException ex) {
            throw new com.lidarpro.backend.common.StorageException("Unable to delete model file from Firebase Storage.", ex);
        }
    }

    private Storage storage() {
        if (storage != null) {
            return storage;
        }

        try {
            GoogleCredentials credentials = resolveCredentials();
            storage = StorageOptions.newBuilder()
                .setProjectId(projectId)
                .setCredentials(credentials)
                .build()
                .getService();
            log.info("storage_firebase_client_ready projectId={} bucket={} credentialSource={}", projectId, bucket, credentialSource());
            return storage;
        } catch (IOException ex) {
            throw new IllegalStateException(
                "Firebase Storage credentials are not configured. Set APP_STORAGE_FIREBASE_CREDENTIALS_JSON, " +
                "APP_STORAGE_FIREBASE_CREDENTIALS_BASE64, APP_STORAGE_FIREBASE_CREDENTIALS_FILE, or GOOGLE_APPLICATION_CREDENTIALS.",
                ex
            );
        }
    }

    private GoogleCredentials resolveCredentials() throws IOException {
        if (StringUtils.hasText(storageProperties.getFirebaseCredentialsJson())) {
            try (InputStream inputStream = new ByteArrayInputStream(
                storageProperties.getFirebaseCredentialsJson().trim().getBytes(java.nio.charset.StandardCharsets.UTF_8)
            )) {
                return scoped(GoogleCredentials.fromStream(inputStream));
            }
        }

        if (StringUtils.hasText(storageProperties.getFirebaseCredentialsBase64())) {
            byte[] decoded = Base64.getDecoder().decode(storageProperties.getFirebaseCredentialsBase64().trim());
            try (InputStream inputStream = new ByteArrayInputStream(decoded)) {
                return scoped(GoogleCredentials.fromStream(inputStream));
            }
        }

        if (StringUtils.hasText(storageProperties.getFirebaseCredentialsFile())) {
            Path path = Path.of(storageProperties.getFirebaseCredentialsFile().trim()).toAbsolutePath().normalize();
            try (InputStream inputStream = Files.newInputStream(path)) {
                return scoped(GoogleCredentials.fromStream(inputStream));
            }
        }

        return scoped(GoogleCredentials.getApplicationDefault());
    }

    private String credentialSource() {
        if (StringUtils.hasText(storageProperties.getFirebaseCredentialsJson())) {
            return "env_json";
        }
        if (StringUtils.hasText(storageProperties.getFirebaseCredentialsBase64())) {
            return "env_base64";
        }
        if (StringUtils.hasText(storageProperties.getFirebaseCredentialsFile())) {
            return "file";
        }
        return "application_default";
    }

    private GoogleCredentials scoped(GoogleCredentials credentials) {
        return credentials.createScopedRequired() ? credentials.createScoped(STORAGE_SCOPES) : credentials;
    }

    private String require(String value, String message) {
        if (!StringUtils.hasText(value)) {
            throw new IllegalStateException(message);
        }

        return value.trim();
    }

    private String extension(String filename) {
        if (!StringUtils.hasText(filename)) {
            return ".glb";
        }

        int idx = filename.lastIndexOf('.');
        if (idx < 0 || idx == filename.length() - 1) {
            return ".glb";
        }

        String ext = filename.substring(idx).toLowerCase(Locale.ROOT);
        if (ext.length() > 8) {
            return ".glb";
        }

        return ext;
    }

    private String slug(String input) {
        String lower = input.toLowerCase(Locale.ROOT).trim();
        String slugged = lower.replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
        return StringUtils.hasText(slugged) ? slugged : "scan";
    }
}
