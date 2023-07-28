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

    public void test() {
        logger.info("test");
    }

    public void upload(Integer chunks, Integer chunk, String name, MultipartFile file) {
        try {
            File target = new File(uploadPath + "/" + name);
            checkDir(target);
            if (chunk == null) {
                file.transferTo(target);
            } else {
                File temp = new File(getTPath(chunk, chunks, name));
                checkDir(temp);
                file.transferTo(temp);
                pool.submit(() -> {
                    File front = new File(getTPath(chunk - 1, chunks, name));
                    File flagFront = new File(getFPath(chunk - 1, chunks, name));
                    File next = new File(getTPath(chunk + 1, chunks, name));
                    File flag = new File(getFPath(chunk, chunks, name));
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
            File target = new File(uploadPath + "/" + name);
            checkDir(target);
            if (chunk == null) {
                file.transferTo(target);
                logger.info(name + " check: ok " + chunks);
            } else {
                logger.debug("chunk: " + chunk);
                File temp = new File(getTPath(chunk, chunks, name));
                checkDir(temp);
                file.transferTo(temp);
                if (chunk == 0) {
                    logger.info(name + " check: start " + chunks);
                }
                if (chunk == chunks - 1) {
                    logger.info(name + " check: start merge");
                    pool.submit(() -> {
                        try {
                            for (int i = 0; i < chunks; i++) {
                                File tmp = new File(getTPath(i, chunks, name));
                                File flg = new File(getFPath(i, chunks, name));
                                boolean fail = true;
                                for (int j = 0; j < 10; j++) {
                                    if (tmp.exists() & tmp.renameTo(flg)) {
                                        merge(flg, target, i != 0);
                                        fail = false;
                                        break;
                                    } else {
                                        Thread.sleep(1000L);
                                    }
                                }
                                if (fail) {
                                    throw new RuntimeException(" check: fail " + i + "/" + chunks);
                                }
                            }
                            logger.info(name + " check: ok " + chunks);
                            temp.getParentFile().delete();
                        } catch (IOException | InterruptedException e) {
                            e.printStackTrace();
                            for (File f : temp.getParentFile().listFiles()) {
                                f.delete();
                            }
                            temp.getParentFile().delete();
                            target.delete();
                            logger.error(name + "check: fail on " + e.getMessage());
                        }
                    });
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
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