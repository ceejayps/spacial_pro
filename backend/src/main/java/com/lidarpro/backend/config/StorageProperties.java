package com.lidarpro.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.storage")
public class StorageProperties {

    private String provider = "local";
    private String rootDir = "./data/models";
    private String publicBaseUrl = "/api/scans";
    private String firebaseApiKey;
    private String firebaseAuthDomain;
    private String firebaseProjectId;
    private String firebaseBucket;
    private String firebaseMessagingSenderId;
    private String firebaseAppId;
    private String firebaseCredentialsJson;
    private String firebaseCredentialsBase64;
    private String firebaseCredentialsFile;

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

    public String getFirebaseApiKey() {
        return firebaseApiKey;
    }

    public void setFirebaseApiKey(String firebaseApiKey) {
        this.firebaseApiKey = firebaseApiKey;
    }

    public String getFirebaseAuthDomain() {
        return firebaseAuthDomain;
    }

    public void setFirebaseAuthDomain(String firebaseAuthDomain) {
        this.firebaseAuthDomain = firebaseAuthDomain;
    }

    public String getFirebaseProjectId() {
        return firebaseProjectId;
    }

    public void setFirebaseProjectId(String firebaseProjectId) {
        this.firebaseProjectId = firebaseProjectId;
    }

    public String getFirebaseBucket() {
        return firebaseBucket;
    }

    public void setFirebaseBucket(String firebaseBucket) {
        this.firebaseBucket = firebaseBucket;
    }

    public String getFirebaseMessagingSenderId() {
        return firebaseMessagingSenderId;
    }

    public void setFirebaseMessagingSenderId(String firebaseMessagingSenderId) {
        this.firebaseMessagingSenderId = firebaseMessagingSenderId;
    }

    public String getFirebaseAppId() {
        return firebaseAppId;
    }

    public void setFirebaseAppId(String firebaseAppId) {
        this.firebaseAppId = firebaseAppId;
    }

    public String getFirebaseCredentialsJson() {
        return firebaseCredentialsJson;
    }

    public void setFirebaseCredentialsJson(String firebaseCredentialsJson) {
        this.firebaseCredentialsJson = firebaseCredentialsJson;
    }

    public String getFirebaseCredentialsBase64() {
        return firebaseCredentialsBase64;
    }

    public void setFirebaseCredentialsBase64(String firebaseCredentialsBase64) {
        this.firebaseCredentialsBase64 = firebaseCredentialsBase64;
    }

    public String getFirebaseCredentialsFile() {
        return firebaseCredentialsFile;
    }

    public void setFirebaseCredentialsFile(String firebaseCredentialsFile) {
        this.firebaseCredentialsFile = firebaseCredentialsFile;
    }
}
