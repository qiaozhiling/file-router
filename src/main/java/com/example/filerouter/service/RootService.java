package com.example.filerouter.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.util.FileCopyUtils;

import javax.servlet.ServletOutputStream;
import javax.servlet.http.HttpServletResponse;
import java.io.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

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

    protected void flushFile(HttpServletResponse response, File f) throws IOException {
        ServletOutputStream op = response.getOutputStream();
        response.reset();
        response.setCharacterEncoding("utf-8");
        response.setHeader("Content-Disposition", "attachment;filename=" + URLEncoder.encode(f.getName(), StandardCharsets.UTF_8));
        response.setHeader("Content-Length", "" + f.length());
        FileInputStream fis = new FileInputStream(f);
        BufferedInputStream bis = new BufferedInputStream(fis);
        BufferedOutputStream bos = new BufferedOutputStream(op);
        FileCopyUtils.copy(bis, bos);
        bis.close();
        bos.close();
        op.close();
        fis.close();
    }

}