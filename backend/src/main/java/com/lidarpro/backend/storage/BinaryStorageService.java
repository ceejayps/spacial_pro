package com.lidarpro.backend.storage;

import org.springframework.core.io.Resource;
import org.springframework.web.multipart.MultipartFile;

public interface BinaryStorageService {

    StoredObject save(MultipartFile file, String namespace);

    Resource loadAsResource(String storagePath);

    void delete(String storagePath);
}
