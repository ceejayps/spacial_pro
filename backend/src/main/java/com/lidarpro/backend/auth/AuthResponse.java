package com.lidarpro.backend.auth;

import com.lidarpro.backend.user.UserProfileResponse;

public record AuthResponse(
    String accessToken,
    String tokenType,
    UserProfileResponse user
) {

    public static AuthResponse bearer(String token, UserProfileResponse user) {
        return new AuthResponse(token, "Bearer", user);
    }
}
