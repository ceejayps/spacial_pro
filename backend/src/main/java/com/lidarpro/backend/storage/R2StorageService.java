package com.lidarpro.backend.storage;

import java.io.IOException;
import java.net.URI;
import java.util.Locale;
import java.util.UUID;

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

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

@Service
@ConditionalOnProperty(prefix = "app.storage", name = "provider", havingValue = "r2")
public class R2StorageService implements BinaryStorageService {

    private final StorageProperties storageProperties;
    private S3Client s3Client;
    private String bucket;

    public R2StorageService(StorageProperties storageProperties) {
        this.storageProperties = storageProperties;
    }

    @PostConstruct
    void init() {
        this.bucket = require(storageProperties.getR2Bucket(), "APP_STORAGE_R2_BUCKET is required when provider=r2.");
        String accessKeyId = require(
            storageProperties.getR2AccessKeyId(),
            "APP_STORAGE_R2_ACCESS_KEY_ID is required when provider=r2."
        );
        String secretAccessKey = require(
            storageProperties.getR2SecretAccessKey(),
            "APP_STORAGE_R2_SECRET_ACCESS_KEY is required when provider=r2."
        );
        String endpoint = resolveEndpoint();
        String region = StringUtils.hasText(storageProperties.getR2Region()) ? storageProperties.getR2Region().trim() : "auto";

        this.s3Client = S3Client.builder()
            .endpointOverride(URI.create(endpoint))
            .region(Region.of(region))
            .credentialsProvider(
                StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKeyId, secretAccessKey))
            )
            .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
            .build();
    }

    @Override
    public StoredObject save(MultipartFile file, String namespace) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Model file is required.");
        }

        String ext = extension(file.getOriginalFilename());
        String safeNamespace = StringUtils.hasText(namespace) ? slug(namespace) : "scan";
        String key = safeNamespace + "/" + UUID.randomUUID() + ext;

        PutObjectRequest request = PutObjectRequest.builder()
            .bucket(bucket)
            .key(key)
            .contentType(StringUtils.hasText(file.getContentType()) ? file.getContentType() : "application/octet-stream")
            .build();

        try {
            s3Client.putObject(request, RequestBody.fromInputStream(file.getInputStream(), file.getSize()));
            return new StoredObject(
                key,
                file.getOriginalFilename(),
                file.getContentType(),
                file.getSize()
            );
        } catch (IOException ex) {
            throw new StorageException("Unable to read model file stream.", ex);
        } catch (S3Exception ex) {
            throw new StorageException("Unable to upload model file to R2.", ex);
        }
    }

    @Override
    public Resource loadAsResource(String storagePath) {
        String key = require(storagePath, "Storage path is required.");

        try {
            GetObjectRequest request = GetObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .build();
            ResponseInputStream<GetObjectResponse> response = s3Client.getObject(request);
            return new InputStreamResource(response);
        } catch (NoSuchKeyException ex) {
            throw new NotFoundException("Stored model file not found.");
        } catch (S3Exception ex) {
            if (ex.statusCode() == 404) {
                throw new NotFoundException("Stored model file not found.");
            }
            throw new StorageException("Unable to read model file from R2.", ex);
        }
    }

    @Override
    public void delete(String storagePath) {
        String key = require(storagePath, "Storage path is required.");

        try {
            s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
        } catch (S3Exception ex) {
            throw new StorageException("Unable to delete model file from R2.", ex);
        }
    }

    private String resolveEndpoint() {
        if (StringUtils.hasText(storageProperties.getR2Endpoint())) {
            return storageProperties.getR2Endpoint().trim();
        }

        String accountId = require(
            storageProperties.getR2AccountId(),
            "APP_STORAGE_R2_ACCOUNT_ID or APP_STORAGE_R2_ENDPOINT is required when provider=r2."
        );
        return "https://" + accountId + ".r2.cloudflarestorage.com";
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
