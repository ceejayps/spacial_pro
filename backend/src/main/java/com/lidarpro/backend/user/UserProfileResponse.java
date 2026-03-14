package com.lidarpro.backend.user;

import java.time.Instant;

public record UserProfileResponse(
    String id,
    String email,
    String fullName,
    Instant createdAt,
    Instant updatedAt
) {

    public static UserProfileResponse fromEntity(AppUserEntity user) {
        return new UserProfileResponse(
            user.getId().toString(),
            user.getEmail(),
            user.getFullName(),
            user.getCreatedAt(),
            user.getUpdatedAt()
        );
    }
}
