package com.example.filerouter.common;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "file")
public class FileProperties {

    private String basePath;
    private String uploadDir;
    private String tempDir;
    private String clickBoardPicName;

    public String getBasePath() {
        return basePath;
    }

    public void setBasePath(String basePath) {
        this.basePath = basePath;
    }

    public String getUploadDir() {
        return uploadDir;
    }

    public void setUploadDir(String uploadDir) {
        this.uploadDir = uploadDir;
    }

    public String getTempDir() {
        return tempDir;
    }

    public void setTempDir(String tempDir) {
        this.tempDir = tempDir;
    }

    public String getClickBoardPicName() {
        return clickBoardPicName;
    }

    public void setClickBoardPicName(String clickBoardPicName) {
        this.clickBoardPicName = clickBoardPicName;
    }
}