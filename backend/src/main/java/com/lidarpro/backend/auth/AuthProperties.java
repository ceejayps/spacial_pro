package com.lidarpro.backend.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.auth")
public class AuthProperties {

    private String jwtSecret = "change-me-change-me-change-me-change-me";
    private long accessTokenMinutes = 120;
    private String jwtIssuer = "lidarpro-backend";
    private String jwtAudience = "lidarpro-mobile-app";
    private int maxAttemptsPerWindow = 10;
    private int attemptWindowMinutes = 10;
    private int lockMinutes = 15;

    public String getJwtSecret() {
        return jwtSecret;
    }

    public void setJwtSecret(String jwtSecret) {
        this.jwtSecret = jwtSecret;
    }

    public long getAccessTokenMinutes() {
        return accessTokenMinutes;
    }

    public void setAccessTokenMinutes(long accessTokenMinutes) {
        this.accessTokenMinutes = accessTokenMinutes;
    }

    public String getJwtIssuer() {
        return jwtIssuer;
    }

    public void setJwtIssuer(String jwtIssuer) {
        this.jwtIssuer = jwtIssuer;
    }

    public String getJwtAudience() {
        return jwtAudience;
    }

    public void setJwtAudience(String jwtAudience) {
        this.jwtAudience = jwtAudience;
    }

    public int getMaxAttemptsPerWindow() {
        return maxAttemptsPerWindow;
    }

    public void setMaxAttemptsPerWindow(int maxAttemptsPerWindow) {
        this.maxAttemptsPerWindow = maxAttemptsPerWindow;
    }

    public int getAttemptWindowMinutes() {
        return attemptWindowMinutes;
    }

    public void setAttemptWindowMinutes(int attemptWindowMinutes) {
        this.attemptWindowMinutes = attemptWindowMinutes;
    }

    public int getLockMinutes() {
        return lockMinutes;
    }

    public void setLockMinutes(int lockMinutes) {
        this.lockMinutes = lockMinutes;
    }
}
