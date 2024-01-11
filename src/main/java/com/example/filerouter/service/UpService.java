package com.example.filerouter.service;

import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class UpService extends RootService {

    private final ExecutorService pool = Executors.newFixedThreadPool(15);

    //    public TreeMap<String, UploadingFile> uploadingFileMap = new TreeMap<>();
//    private short countDown = -1;

    public void infoTest() {
        logger.info("test");
    }

    @Deprecated
    public void upload(Integer chunks, Integer chunk, String name, MultipartFile file) {
        try {
            File target = new File(uploadPath + "/" + name);
            checkDir(target);
            if (chunk == null) {
                file.transferTo(target);
            } else {
                File temp = new File(getTempFilePath(chunk, chunks, name));
                checkDir(temp);
                file.transferTo(temp);
                pool.submit(() -> {
                    File front = new File(getTempFilePath(chunk - 1, chunks, name));
                    File flagFront = new File(getFlagFilePath(chunk - 1, chunks, name));
                    File next = new File(getTempFilePath(chunk + 1, chunks, name));
                    File flag = new File(getFlagFilePath(chunk, chunks, name));
                    try {
                        if (chunk == 0) {
                            merge(temp, target, false);
                            flag.createNewFile();
                            logger.info(name + " check: start " + chunks);
                        } else {
                            for (int i = 0; i < 50; i++) {
                                boolean frontOk = flagFront.exists();
                                boolean nextOk = (chunk == chunks - 1) || next.exists();
                                if (frontOk & nextOk) {
                                    merge(temp, target, true);
                                    flagFront.renameTo(flag);
                                    if (chunk == chunks - 1) {
                                        flag.delete();
                                        logger.info(name + " check: ok " + chunks);
                                    }
                                    return;
                                } else {
                                    Thread.sleep(200L);
                                }
                            }
                            throw new IOException("chunk lost");
                        }
                    } catch (IOException | InterruptedException e) {
                        e.printStackTrace();
                        front.delete();
                        temp.delete();
                        flagFront.delete();
                        target.delete();
                        logger.error(name + "check: fail on " + chunk + "/" + chunks);
                    }
                });
            }
        } catch (IOException e) {
            e.printStackTrace();
            logger.error(name + "check: fail on " + chunk + "/" + chunks);
        }
    }

    public void upload2(Integer chunks, Integer chunk, String name, MultipartFile file) {
        try {
            if (chunk == null) { // only one clip
                File target = new File(uploadPath + "/" + name);
                checkDir(target);
                file.transferTo(target);
                logger.info(name + " check: ok " + chunks);
            } else { // more clips
                logger.debug("chunk: " + chunk);
                File tempFile = new File(getTempFilePath(chunk, chunks, name));
                checkDir(tempFile);
                file.transferTo(tempFile);
                if (chunk == 0) { // first clip
                    logger.info(name + " check: start " + chunks);
                    //todo
//                    pool.submit(() -> {
//                        if (countDown == 1) {
//                            countDown--;
//                        } else if (countDown == 0) {
//
//                        }
//
//                    });
                }
                if (chunk == chunks - 1) { // last clip
                    logger.info(name + " check: start merge");
                    pool.submit(new MergeThread(chunks, name));
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public void uptext(String cont) {
        logger.info("upload text : " + cont);
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

    private class MergeThread implements Runnable {

        private final int chunks;
        private final String fileName;
        private final File targetFile;
        private final File tempDir;

        public MergeThread(int chunks, String fileName) {
            this.chunks = chunks;
            this.fileName = fileName;
            this.targetFile = new File(uploadPath + "/" + fileName);
            this.tempDir = new File(getTempDirPath(fileName));
        }

        @Override
        public void run() {
            try {
                for (int i = 0; i < chunks; i++) {
                    File tmp = new File(getTempFilePath(i, chunks, fileName));
                    File flg = new File(getFlagFilePath(i, chunks, fileName));
                    boolean fail = true;
                    for (int j = 0; j < 10; j++) {
                        if (tmp.exists() & tmp.renameTo(flg)) {
                            merge(flg, targetFile, i != 0);
                            fail = false;
                            break;
                        } else {
                            Thread.sleep(1000L);
                        }
                    }
                    if (fail) throw new RuntimeException(" check: fail " + i + "/" + chunks);
                }
                logger.info(fileName + " check: ok " + chunks);
                tempDir.delete();
            } catch (IOException | InterruptedException e) {
                e.printStackTrace();
                for (File f : tempDir.listFiles()) {
                    f.delete();
                }
                tempDir.delete();
                targetFile.delete();
                logger.error(fileName + "check: fail on " + e.getMessage());
            }
        }
    }
}