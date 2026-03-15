package com.lidarpro.backend.storage;

public record StoredObject(
    String storagePath,
    String originalFilename,
    String contentType,
    long sizeBytes
) {
}
