package com.lidarpro.backend.storage;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.UUID;

import com.lidarpro.backend.common.NotFoundException;
import com.lidarpro.backend.common.StorageException;
import com.lidarpro.backend.config.StorageProperties;

import jakarta.annotation.PostConstruct;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

@Service
@ConditionalOnProperty(prefix = "app.storage", name = "provider", havingValue = "local", matchIfMissing = true)
public class LocalDiskStorageService implements BinaryStorageService {

    private final StorageProperties storageProperties;
    private Path root;

    public LocalDiskStorageService(StorageProperties storageProperties) {
        this.storageProperties = storageProperties;
    }

    @PostConstruct
    void init() {
        try {
            root = Paths.get(storageProperties.getRootDir()).normalize().toAbsolutePath();
            Files.createDirectories(root);
        } catch (IOException ex) {
            throw new StorageException("Unable to initialize storage root directory.", ex);
        }
    }

    @Override
    public StoredObject save(MultipartFile file, String namespace) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Model file is required.");
        }

        String ext = extension(file.getOriginalFilename());
        String safeNamespace = StringUtils.hasText(namespace) ? slug(namespace) : "scan";
        String relativePath = safeNamespace + "/" + UUID.randomUUID() + ext;
        Path target = root.resolve(relativePath).normalize();

        if (!target.startsWith(root)) {
            throw new StorageException("Invalid storage path.");
        }

        try {
            Files.createDirectories(target.getParent());
            Files.copy(file.getInputStream(), target, StandardCopyOption.REPLACE_EXISTING);
            return new StoredObject(
                relativePath,
                file.getOriginalFilename(),
                file.getContentType(),
                file.getSize()
            );
        } catch (IOException ex) {
            throw new StorageException("Unable to write model file to storage.", ex);
        }
    }

    @Override
    public Resource loadAsResource(String storagePath) {
        Path resolved = resolve(storagePath);
        if (!Files.exists(resolved)) {
            throw new NotFoundException("Stored model file not found.");
        }

        return new FileSystemResource(resolved);
    }

    @Override
    public void delete(String storagePath) {
        Path resolved = resolve(storagePath);
        try {
            Files.deleteIfExists(resolved);
        } catch (IOException ex) {
            throw new StorageException("Unable to delete stored model file.", ex);
        }
    }

    private Path resolve(String storagePath) {
        if (!StringUtils.hasText(storagePath)) {
            throw new IllegalArgumentException("Storage path is required.");
        }

        Path resolved = root.resolve(storagePath).normalize();
        if (!resolved.startsWith(root)) {
            throw new StorageException("Invalid storage path.");
        }

        return resolved;
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
