package com.lidarpro.backend.storage;

import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.Channels;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.UUID;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.WriteChannel;
import com.google.cloud.storage.Blob;
import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageOptions;
import com.lidarpro.backend.common.NotFoundException;
import com.lidarpro.backend.common.StorageException;
import com.lidarpro.backend.config.StorageProperties;

import jakarta.annotation.PostConstruct;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

@Service
@ConditionalOnProperty(prefix = "app.storage", name = "provider", havingValue = "firebase")
public class FirebaseStorageService implements BinaryStorageService {

    private final StorageProperties storageProperties;
    private Storage storage;
    private String bucket;

    public FirebaseStorageService(StorageProperties storageProperties) {
        this.storageProperties = storageProperties;
    }

    @PostConstruct
    void init() {
        this.bucket = require(
            storageProperties.getFirebaseBucket(),
            "APP_STORAGE_FIREBASE_BUCKET is required when provider=firebase."
        );

        try {
            GoogleCredentials credentials = loadCredentials();
            StorageOptions.Builder builder = StorageOptions.newBuilder().setCredentials(credentials);

            if (StringUtils.hasText(storageProperties.getFirebaseProjectId())) {
                builder.setProjectId(storageProperties.getFirebaseProjectId().trim());
            }

            this.storage = builder.build().getService();
        } catch (IOException ex) {
            throw new IllegalStateException("Unable to initialize Firebase Storage credentials.", ex);
        }
    }

    @Override
    public StoredObject save(MultipartFile file, String namespace) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Model file is required.");
        }

        String ext = extension(file.getOriginalFilename());
        String safeNamespace = StringUtils.hasText(namespace) ? slug(namespace) : "scan";
        String key = safeNamespace + "/" + UUID.randomUUID() + ext;
        BlobInfo blobInfo = BlobInfo.newBuilder(BlobId.of(bucket, key))
            .setContentType(StringUtils.hasText(file.getContentType()) ? file.getContentType() : "application/octet-stream")
            .build();

        try (InputStream inputStream = file.getInputStream(); WriteChannel writeChannel = storage.writer(blobInfo)) {
            inputStream.transferTo(Channels.newOutputStream(writeChannel));
            return new StoredObject(
                key,
                file.getOriginalFilename(),
                file.getContentType(),
                file.getSize()
            );
        } catch (IOException ex) {
            throw new StorageException("Unable to read model file stream.", ex);
        } catch (com.google.cloud.storage.StorageException ex) {
            throw new StorageException("Unable to upload model file to Firebase Storage.", ex);
        }
    }

    @Override
    public Resource loadAsResource(String storagePath) {
        String key = require(storagePath, "Storage path is required.");

        try {
            Blob blob = storage.get(BlobId.of(bucket, key));
            if (blob == null || !blob.exists()) {
                throw new NotFoundException("Stored model file not found.");
            }

            return new InputStreamResource(Channels.newInputStream(blob.reader())) {
                @Override
                public String getFilename() {
                    int slash = key.lastIndexOf('/');
                    return slash >= 0 ? key.substring(slash + 1) : key;
                }

                @Override
                public long contentLength() {
                    return blob.getSize();
                }
            };
        } catch (com.google.cloud.storage.StorageException ex) {
            if (ex.getCode() == 404) {
                throw new NotFoundException("Stored model file not found.");
            }
            throw new StorageException("Unable to read model file from Firebase Storage.", ex);
        }
    }

    @Override
    public void delete(String storagePath) {
        String key = require(storagePath, "Storage path is required.");

        try {
            storage.delete(BlobId.of(bucket, key));
        } catch (com.google.cloud.storage.StorageException ex) {
            throw new StorageException("Unable to delete model file from Firebase Storage.", ex);
        }
    }

    private GoogleCredentials loadCredentials() throws IOException {
        if (!StringUtils.hasText(storageProperties.getFirebaseCredentialsPath())) {
            return GoogleCredentials.getApplicationDefault();
        }

        Path credentialsPath = Paths.get(storageProperties.getFirebaseCredentialsPath().trim()).normalize().toAbsolutePath();
        try (InputStream inputStream = Files.newInputStream(credentialsPath)) {
            return GoogleCredentials.fromStream(inputStream);
        }
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
