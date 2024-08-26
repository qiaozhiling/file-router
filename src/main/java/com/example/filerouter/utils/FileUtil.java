package com.example.filerouter.utils;

import com.example.filerouter.common.FileProperties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.util.FileCopyUtils;

import javax.annotation.PostConstruct;
import javax.servlet.ServletOutputStream;
import javax.servlet.http.HttpServletResponse;
import java.io.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@Component
@EnableConfigurationProperties(FileProperties.class)
public class FileUtil {

    @Autowired
    private FileProperties fileProperties;

    public static String basePath;
    public static String uploadPath;
    public static String tempPath;
    public static String clickBoardPicName;

    @PostConstruct
    public void init() {
        basePath = basePath == null ? fileProperties.getBasePath() : basePath;
        uploadPath = basePath + fileProperties.getUploadDir();
        tempPath = uploadPath + fileProperties.getTempDir();
        clickBoardPicName = fileProperties.getClickBoardPicName();
    }

    public static void checkDir(File f) {
        if (!f.getParentFile().exists()) {
            f.getParentFile().mkdirs();
        }
    }

    public static String getTempDirPath(String name) {
        return tempPath + "/" + name;
    }

    public static String getTempFilePath(Integer chunk, Integer chunks, String name) {
        return tempPath + "/" + name + "/" + chunk + "-" + chunks + "-" + name + ".tmp";
    }

    public static void flushFile(HttpServletResponse response, File f) throws IOException {
        ServletOutputStream op = response.getOutputStream();
        response.reset();
        response.setCharacterEncoding("utf-8");
        response.setHeader("Content-Length", "" + f.length());
        if (f.getName().endsWith(".html")) {
            response.setHeader("content-type", "text/html");
        } else {
            response.setHeader("Content-Disposition", "attachment;filename=" + URLEncoder.encode(f.getName(), StandardCharsets.UTF_8));
        }
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