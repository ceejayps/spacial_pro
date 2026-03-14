package com.lidarpro.backend.security;

import java.util.UUID;

public record AppUserPrincipal(
    UUID userId,
    String email,
    String fullName
) {
}
