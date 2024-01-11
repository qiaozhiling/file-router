package com.example.filerouter.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;

import java.io.File;

public abstract class RootService {
    protected final Logger logger = LoggerFactory.getLogger(this.getClass());

    @Value("${file.basePath}")
    protected String basePath;

    @Value("${file.uploadPath}")
    protected String uploadPath;

    @Value("${file.tempPath}")
    protected String tempPath;

    @Value("${file.clickBoardPicName}")
    protected String clickBoardPicName;

    protected void checkDir(File f) {
        if (!f.getParentFile().exists()) {
            f.getParentFile().mkdirs();
        }
    }

    protected String getTempDirPath(String name) {
        return tempPath + "/" + name;
    }

    protected String getTempFilePath(Integer chunk, Integer chunks, String name) {
        return tempPath + "/" + name + "/" + chunk + "-" + chunks + "-" + name + ".tmp";
    }

    protected String getFlagFilePath(Integer chunk, Integer chunks, String name) {
        return tempPath + "/" + name + "/" + chunk + "-" + chunks + "-" + name + ".flag.tmp";
    }

}