package com.lidarpro.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.storage")
public class StorageProperties {

    private String provider = "local";
    private String rootDir = "./data/models";
    private String publicBaseUrl = "/api/scans";
    private String firebaseBucket;
    private String firebaseProjectId;
    private String firebaseCredentialsPath;

    public String getProvider() {
        return provider;
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public String getRootDir() {
        return rootDir;
    }

    public void setRootDir(String rootDir) {
        this.rootDir = rootDir;
    }

    public String getPublicBaseUrl() {
        return publicBaseUrl;
    }

    public void setPublicBaseUrl(String publicBaseUrl) {
        this.publicBaseUrl = publicBaseUrl;
    }

    public String getFirebaseBucket() {
        return firebaseBucket;
    }

    public void setFirebaseBucket(String firebaseBucket) {
        this.firebaseBucket = firebaseBucket;
    }

    public String getFirebaseProjectId() {
        return firebaseProjectId;
    }

    public void setFirebaseProjectId(String firebaseProjectId) {
        this.firebaseProjectId = firebaseProjectId;
    }

    public String getFirebaseCredentialsPath() {
        return firebaseCredentialsPath;
    }

    public void setFirebaseCredentialsPath(String firebaseCredentialsPath) {
        this.firebaseCredentialsPath = firebaseCredentialsPath;
    }
}
