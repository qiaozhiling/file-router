package com.example.filerouter.service;

import com.example.filerouter.common.AccompanyThread;
import com.example.filerouter.utils.FileUtil;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.PreDestroy;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class UpService extends RootService {
    private final ExecutorService pool;
    private final ConcurrentMap<String, AccompanyThread> uploadingFileMap = new ConcurrentHashMap<>();

    public UpService() {
        this(Executors.newFixedThreadPool(20));
    }

    UpService(ExecutorService pool) {
        this.pool = pool;
    }

    public String upload(Integer chunks, Integer chunk, String name, MultipartFile file) throws IOException {
        if (name == null || name.isBlank() || file == null) {
            throw new IllegalArgumentException("请选择要上传的文件。");
        }
        try {
            if (chunk == null) {
                File target = new File(FileUtil.uploadPath + "/" + name);
                FileUtil.checkDir(target);
                file.transferTo(target);
                if (!target.isFile() || target.length() != file.getSize()) {
                    throw new IOException("保存后的文件大小不匹配。");
                }
                return "completed";
            }
            if (chunks == null || chunks < 2 || chunk < 0 || chunk >= chunks) {
                throw new IllegalArgumentException("上传分片参数无效。");
            }
            AccompanyThread task = uploadingFileMap.get(name);
            if (task == null && chunk != 0) throw new IOException("上传任务已失效，请重新上传。");
            if (task != null) task.checkActive(chunks);
            File part = new File(FileUtil.getTempFilePath(chunk, chunks, name));
            FileUtil.checkDir(part);
            file.transferTo(part);
            if (!part.isFile() || part.length() != file.getSize()) {
                throw new IOException("保存后的分片大小不匹配。");
            }
            if (chunk == 0) {
                synchronized (this) {
                    task = uploadingFileMap.get(name);
                    if (task == null) {
                        task = new AccompanyThread(chunks, name, uploadingFileMap);
                        uploadingFileMap.put(name, task);
                        pool.submit(task);
                    } else {
                        task.feed();
                    }
                }
            } else if (chunk == chunks - 1) {
                task.over();
                task.awaitCompletion();
                return "completed";
            } else {
                task.feed();
            }
            return "chunk_received";
        } catch (IOException error) {
            logger.error("Unable to save upload: " + name, error);
            throw error;
        }
    }

    @PreDestroy
    public void shutdown() {
        pool.shutdownNow();
    }
}
