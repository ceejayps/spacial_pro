package com.lidarpro.backend.scan;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ScanRepository extends JpaRepository<ScanEntity, UUID> {

    List<ScanEntity> findAllByOwnerUserIdOrderByCreatedAtDesc(UUID ownerUserId);

    Optional<ScanEntity> findByIdAndOwnerUserId(UUID id, UUID ownerUserId);
}
