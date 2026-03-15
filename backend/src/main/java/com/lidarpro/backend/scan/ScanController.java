package com.lidarpro.backend.scan;

import java.util.List;
import java.util.UUID;

import com.lidarpro.backend.security.AppUserPrincipal;

import jakarta.validation.Valid;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/scans")
public class ScanController {

    private final ScanService scanService;

    public ScanController(ScanService scanService) {
        this.scanService = scanService;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ScanResponse> uploadScan(
        @AuthenticationPrincipal AppUserPrincipal principal,
        @RequestPart("file") MultipartFile file,
        @RequestPart(value = "metadata", required = false) String metadataJson
    ) {
        return ResponseEntity.ok(scanService.create(requireUserId(principal), file, metadataJson));
    }

    @GetMapping
    public ResponseEntity<List<ScanResponse>> listScans(@AuthenticationPrincipal AppUserPrincipal principal) {
        return ResponseEntity.ok(scanService.list(requireUserId(principal)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ScanResponse> getScan(
        @AuthenticationPrincipal AppUserPrincipal principal,
        @PathVariable String id
    ) {
        return ResponseEntity.ok(scanService.getById(requireUserId(principal), id));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<ScanResponse> updateScan(
        @AuthenticationPrincipal AppUserPrincipal principal,
        @PathVariable String id,
        @Valid @RequestBody UpdateScanMetadataRequest request
    ) {
        return ResponseEntity.ok(scanService.update(requireUserId(principal), id, request));
    }

    @PostMapping("/{id}/sync")
    public ResponseEntity<ScanResponse> syncScan(
        @AuthenticationPrincipal AppUserPrincipal principal,
        @PathVariable String id,
        @RequestBody(required = false) SyncScanRequest request
    ) {
        return ResponseEntity.ok(scanService.markSynced(requireUserId(principal), id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteScan(
        @AuthenticationPrincipal AppUserPrincipal principal,
        @PathVariable String id
    ) {
        scanService.delete(requireUserId(principal), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/file")
    public ResponseEntity<Resource> streamModelFile(
        @AuthenticationPrincipal AppUserPrincipal principal,
        @PathVariable String id
    ) {
        ScanFileDownload file = scanService.readModelFile(requireUserId(principal), id);

        String filename = sanitizeFilename(file.originalFilename());
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(file.contentType()))
            .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"%s\"".formatted(filename))
            .body(file.resource());
    }

    private String sanitizeFilename(String value) {
        if (!StringUtils.hasText(value)) {
            return "model.glb";
        }

        return value.replace('"', '_');
    }

    private UUID requireUserId(AppUserPrincipal principal) {
        if (principal == null || principal.userId() == null) {
            throw new IllegalArgumentException("Authenticated user is required.");
        }

        return principal.userId();
    }
}
