package com.lidarpro.backend.security;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import javax.crypto.SecretKey;

import com.lidarpro.backend.auth.AuthProperties;
import com.lidarpro.backend.user.AppUserEntity;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

@Service
public class JwtService {

    private final SecretKey signingKey;
    private final long accessTokenMinutes;
    private final String jwtIssuer;
    private final String jwtAudience;

    public JwtService(AuthProperties authProperties) {
        String secret = String.valueOf(authProperties.getJwtSecret()).trim();
        if (!StringUtils.hasText(secret) || secret.length() < 32) {
            throw new IllegalStateException("APP_AUTH_JWT_SECRET must be at least 32 characters.");
        }

        this.jwtIssuer = sanitizeClaim(authProperties.getJwtIssuer(), "lidarpro-backend");
        this.jwtAudience = sanitizeClaim(authProperties.getJwtAudience(), "lidarpro-mobile-app");

        byte[] keyBytes = secret.getBytes(StandardCharsets.UTF_8);
        this.signingKey = Keys.hmacShaKeyFor(keyBytes);
        this.accessTokenMinutes = Math.max(5, authProperties.getAccessTokenMinutes());
    }

    public String issueAccessToken(AppUserEntity user) {
        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(accessTokenMinutes * 60);

        return Jwts.builder()
            .subject(user.getId().toString())
            .claim("email", user.getEmail())
            .claim("name", user.getFullName())
            .issuer(jwtIssuer)
            .audience().add(jwtAudience).and()
            .issuedAt(Date.from(now))
            .expiration(Date.from(expiresAt))
            .signWith(signingKey)
            .compact();
    }

    public AppUserPrincipal parsePrincipal(String token) {
        try {
            Jws<Claims> parsed = Jwts.parser()
                .verifyWith(signingKey)
                .requireIssuer(jwtIssuer)
                .build()
                .parseSignedClaims(token);

            Claims claims = parsed.getPayload();
            if (!hasExpectedAudience(extractAudienceClaim(claims))) {
                return null;
            }
            UUID userId = UUID.fromString(claims.getSubject());
            String email = String.valueOf(claims.get("email"));
            String fullName = String.valueOf(claims.get("name"));

            return new AppUserPrincipal(userId, email, fullName);
        } catch (JwtException | IllegalArgumentException ex) {
            return null;
        }
    }

    private String sanitizeClaim(String value, String fallback) {
        String normalized = Objects.toString(value, "").trim();
        return StringUtils.hasText(normalized) ? normalized : fallback;
    }

    private Object extractAudienceClaim(Claims claims) {
        Object aud = claims.get("aud");
        if (aud != null) {
            return aud;
        }

        try {
            // JJWT 0.12 may expose audience through dedicated API depending on parser config.
            return claims.getAudience();
        } catch (Exception ignored) {
            return null;
        }
    }

    private boolean hasExpectedAudience(Object claimValue) {
        if (claimValue == null) {
            return false;
        }

        if (claimValue instanceof String value) {
            String normalized = value.trim();
            if (jwtAudience.equals(normalized)) {
                return true;
            }

            // Some providers serialize "aud" as a space-delimited string.
            String[] parts = normalized.split("\\s+");
            for (String part : parts) {
                if (jwtAudience.equals(part)) {
                    return true;
                }
            }

            return false;
        }

        if (claimValue instanceof List<?> values) {
            return values.stream().anyMatch((value) -> jwtAudience.equals(String.valueOf(value)));
        }

        if (claimValue instanceof Collection<?> values) {
            return values.stream().anyMatch((value) -> jwtAudience.equals(String.valueOf(value)));
        }

        return false;
    }
}
