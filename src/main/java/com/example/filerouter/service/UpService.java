package com.example.filerouter.service;

import com.example.filerouter.common.AccompanyThread;
import com.example.filerouter.utils.FileUtil;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;


@Service
public class UpService extends RootService {

    private final ExecutorService pool = Executors.newFixedThreadPool(15);

    private final HashMap<String, AccompanyThread> uploadingFileMap = new HashMap<>();

    public void upload(Integer chunks, Integer chunk, String name, MultipartFile file) {
        try {
            if (chunk == null) { // only one clip
                File target = new File(FileUtil.uploadPath + "/" + name);
                FileUtil.checkDir(target);
                file.transferTo(target);
                logger.info("check ok " + chunks + " : " + name);
            } else { // more clips
                logger.debug("chunk arrived : " + chunk + " : " + name);
                File tempFile = new File(FileUtil.getTempFilePath(chunk, chunks, name));
                FileUtil.checkDir(tempFile);
                file.transferTo(tempFile);
                AccompanyThread mergeThread;
                if (chunk == 0) { // first clip
                    logger.info("start " + chunks + " clips: " + name);
                    mergeThread = new AccompanyThread(chunks, name, uploadingFileMap);
                    uploadingFileMap.put(name, mergeThread);
                    pool.submit(mergeThread);
                } else if (chunk == chunks - 1) { // last clip
                    logger.info("start merge : " + name);
                    mergeThread = getAcThread(name);
                    mergeThread.over();
                } else {
                    logger.debug("size of map : " + uploadingFileMap.size());
                    mergeThread = getAcThread(name);
                    mergeThread.feed();
                    logger.debug("feed " + chunk + " : " + name);
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private AccompanyThread getAcThread(String name) {
        AccompanyThread mergeThread;
        do {
            mergeThread = uploadingFileMap.get(name);
        } while (mergeThread == null);
        return mergeThread;
    }

}