package com.example.filerouter.common;

import com.example.filerouter.utils.FileUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.concurrent.TimeUnit;


public class AccompanyThread implements Runnable {
    private final int chunks;
    private final String fileName;
    private final File targetFile, tempDir;
    private final Logger logger;
    private final HashMap<String, AccompanyThread> uploadingFileMap;
    private int counter;
    private boolean over;

    public AccompanyThread(int chunks, String fileName, HashMap<String, AccompanyThread> map) {
        this.chunks = chunks;
        this.fileName = fileName;
        this.targetFile = new File(FileUtil.uploadPath + "/" + fileName);
        this.tempDir = new File(FileUtil.getTempDirPath(fileName));
        this.logger = LoggerFactory.getLogger(this.getClass());
        this.uploadingFileMap = map;
        this.counter = 5;
        this.over = false;
    }

    @Override
    public void run() {
        while (counter > 0 && !over) {
            try {
                logger.debug("counter :" + counter);
                counter--;
                TimeUnit.SECONDS.sleep(1);
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }
        if (over) {
            mergeFiles();
        } else {
            logger.info("Accompany thread : delete file " + fileName);
            deleteTempFiles();
        }
        uploadingFileMap.remove(fileName);
        logger.debug("Accompany thread : over" + fileName);
    }

    public synchronized void over() {
        over = true;
    }

    public synchronized void feed() {
        if (counter < 10) {
            counter++;
        }
    }

    private void mergeFiles() {
        try {
            for (int i = 0; i < chunks; i++) {
                File tmp = new File(FileUtil.getTempFilePath(i, chunks, fileName));
                boolean fail = true;
                for (int j = 0; j < 10; j++) { // wait 10 seconds for next clip
                    if (tmp.exists()) {
                        merge(tmp, targetFile, i != 0);
                        fail = false;
                        break;
                    } else {
                        TimeUnit.SECONDS.sleep(1);
                    }
                }
                if (fail) throw new RuntimeException("merge failed at " + i + "/" + chunks);
            }
            logger.info("check ok " + chunks + " : " + fileName);
            tempDir.delete();
        } catch (IOException | InterruptedException | RuntimeException e) {
            logger.error("check fail :" + fileName + " caused by " + e.getMessage());
            e.printStackTrace();
            deleteTempFiles();
        }
    }

    private void deleteTempFiles() {
        FileUtil.checkDir(tempDir);
        for (File f : tempDir.listFiles()) {
            f.delete();
        }
        tempDir.delete();
        targetFile.delete();
    }

    private void merge(File from, File to, boolean append) throws IOException {
        FileInputStream fileInputStream = new FileInputStream(from);
        FileOutputStream fileOutputStream = new FileOutputStream(to, append);
        fileOutputStream.write(fileInputStream.readAllBytes());
        fileOutputStream.flush();
        fileInputStream.close();
        fileOutputStream.close();
        from.delete();
    }

}