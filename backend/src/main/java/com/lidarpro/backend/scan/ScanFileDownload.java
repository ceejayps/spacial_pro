package com.lidarpro.backend.scan;

import org.springframework.core.io.Resource;

public record ScanFileDownload(
    Resource resource,
    String contentType,
    String originalFilename
) {
}
