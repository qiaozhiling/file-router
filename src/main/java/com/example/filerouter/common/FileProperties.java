package com.example.filerouter.common;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "file")
public class FileProperties {

    private String basePath;

    private String uploadPath;

    private String tempPath;

    private String clickBoardPicName;

    public String getBasePath() {
        return basePath;
    }

    public void setBasePath(String basePath) {
        this.basePath = basePath;
    }

    public String getUploadPath() {
        return uploadPath;
    }

    public void setUploadPath(String uploadPath) {
        this.uploadPath = uploadPath;
    }

    public String getTempPath() {
        return tempPath;
    }

    public void setTempPath(String tempPath) {
        this.tempPath = tempPath;
    }

    public String getClickBoardPicName() {
        return clickBoardPicName;
    }

    public void setClickBoardPicName(String clickBoardPicName) {
        this.clickBoardPicName = clickBoardPicName;
    }
}