package com.example.filerouter.common;

import com.example.filerouter.utils.FileUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ExecutionException;

/** Collects chunks and reports the actual merge outcome to the final request. */
public class AccompanyThread implements Runnable {
    private final int chunks;
    private final String fileName;
    private final File targetFile, tempDir;
    private final Logger logger = LoggerFactory.getLogger(getClass());
    private final ConcurrentMap<String, AccompanyThread> uploadingFileMap;
    private final CompletableFuture<Void> completion = new CompletableFuture<>();
    private int counter = 5;
    private boolean over, accepting = true;

    public AccompanyThread(int chunks, String fileName, ConcurrentMap<String, AccompanyThread> map) {
        this.chunks = chunks;
        this.fileName = fileName;
        this.targetFile = new File(FileUtil.uploadPath + "/" + fileName);
        this.tempDir = new File(FileUtil.getTempDirPath(fileName));
        this.uploadingFileMap = map;
    }

    @Override
    public void run() {
        Throwable failure = null;
        try {
            synchronized (this) {
                while (counter > 0 && !over) {
                    wait(1000);
                    counter--;
                }
                accepting = false;
                if (!over) throw new IOException("上传任务已超时，请重新上传。");
            }
            mergeFiles();
            logger.info("saved {} chunks: {}", chunks, fileName);
        } catch (IOException | InterruptedException | RuntimeException error) {
            failure = error;
            if (error instanceof InterruptedException) Thread.currentThread().interrupt();
            logger.error("Unable to complete upload: " + fileName, error);
        } catch (Error error) {
            failure = error;
            throw error;
        } finally {
            // Cleanup must never delete an existing destination file or hide the outcome.
            try {
                deleteTempFiles();
            } catch (RuntimeException error) {
                logger.warn("Unable to clean upload temporary files: " + fileName, error);
            }
            uploadingFileMap.remove(fileName, this);
            if (failure == null) completion.complete(null);
            else completion.completeExceptionally(failure);
        }
    }

    public synchronized void checkActive(int expectedChunks) throws IOException {
        if (!accepting || over || expectedChunks != chunks) {
            throw new IOException("上传任务已结束或分片信息不匹配，请重新上传。");
        }
    }

    public synchronized void over() throws IOException {
        checkActive(chunks);
        over = true;
        notifyAll();
    }

    public synchronized void feed() throws IOException {
        checkActive(chunks);
        if (counter < 60) counter++;
    }

    public void awaitCompletion() throws IOException {
        try {
            completion.get();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("等待文件保存被中断，请检查服务器文件后重试。", error);
        } catch (ExecutionException error) {
            throw new IOException("文件合并失败，请检查服务器磁盘空间和写入权限后重试。", error.getCause());
        }
    }

    private void mergeFiles() throws IOException {
        File merged = new File(tempDir, "merged.tmp");
        try (FileOutputStream output = new FileOutputStream(merged)) {
            for (int i = 0; i < chunks; i++) {
                File part = new File(FileUtil.getTempFilePath(i, chunks, fileName));
                if (!part.isFile()) throw new IOException("Missing upload chunk " + i + "/" + chunks);
                Files.copy(part.toPath(), output);
            }
            output.getFD().sync();
        }
        // Publish the complete file only after every chunk has been read and output closed.
        Files.move(merged.toPath(), targetFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }

    private void deleteTempFiles() {
        File[] files = tempDir.listFiles();
        if (files != null) {
            for (File file : files) {
                if (!file.delete()) logger.warn("Unable to remove upload temporary file: {}", file);
            }
            if (!tempDir.delete()) logger.warn("Unable to remove upload temporary directory: {}", tempDir);
        }
    }
}
