package com.lidarpro.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.storage")
public class StorageProperties {

    private String provider = "local";
    private String rootDir = "./data/models";
    private String publicBaseUrl = "/api/scans";
    private String r2Endpoint;
    private String r2AccountId;
    private String r2Bucket;
    private String r2AccessKeyId;
    private String r2SecretAccessKey;
    private String r2Region = "auto";

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

    public String getR2Endpoint() {
        return r2Endpoint;
    }

    public void setR2Endpoint(String r2Endpoint) {
        this.r2Endpoint = r2Endpoint;
    }

    public String getR2AccountId() {
        return r2AccountId;
    }

    public void setR2AccountId(String r2AccountId) {
        this.r2AccountId = r2AccountId;
    }

    public String getR2Bucket() {
        return r2Bucket;
    }

    public void setR2Bucket(String r2Bucket) {
        this.r2Bucket = r2Bucket;
    }

    public String getR2AccessKeyId() {
        return r2AccessKeyId;
    }

    public void setR2AccessKeyId(String r2AccessKeyId) {
        this.r2AccessKeyId = r2AccessKeyId;
    }

    public String getR2SecretAccessKey() {
        return r2SecretAccessKey;
    }

    public void setR2SecretAccessKey(String r2SecretAccessKey) {
        this.r2SecretAccessKey = r2SecretAccessKey;
    }

    public String getR2Region() {
        return r2Region;
    }

    public void setR2Region(String r2Region) {
        this.r2Region = r2Region;
    }
}

