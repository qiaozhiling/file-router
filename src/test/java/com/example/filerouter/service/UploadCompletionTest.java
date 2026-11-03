package com.example.filerouter.service;

import com.example.filerouter.controller.FileController;
import com.example.filerouter.utils.FileUtil;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class UploadCompletionTest {
    @TempDir Path root;
    private String oldUploadPath, oldTempPath;
    private UpService service;
    private MockMvc mvc;

    @BeforeEach void setup() {
        oldUploadPath = FileUtil.uploadPath;
        oldTempPath = FileUtil.tempPath;
        FileUtil.uploadPath = root.toString();
        FileUtil.tempPath = root.resolve("temp").toString();
        configure(new UpService());
    }

    private void configure(UpService replacement) {
        if (service != null) service.shutdown();
        service = replacement;
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "upService", service);
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @AfterEach void cleanup() {
        service.shutdown();
        FileUtil.uploadPath = oldUploadPath;
        FileUtil.tempPath = oldTempPath;
    }

    private MockMultipartFile file(String contents) {
        return new MockMultipartFile("file", "test.bin", "application/octet-stream", contents.getBytes(StandardCharsets.UTF_8));
    }

    private MvcResult part(String name, int chunks, int index, String content) throws Exception {
        return mvc.perform(multipart("/upload").file(file(content)).param("name", name)
                .param("chunks", String.valueOf(chunks)).param("chunk", String.valueOf(index))).andReturn();
    }

    @Test void singleAndEmptyFilesReturnCompletedOnlyAfterSaving() throws Exception {
        for (String content : new String[]{"中文 & + %", ""}) {
            mvc.perform(multipart("/upload").file(file(content)).param("name", "文件.txt"))
                    .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith("application/json"))
                    .andExpect(jsonPath("$.status").value("completed"));
            assertEquals(content, Files.readString(root.resolve("文件.txt")));
        }
    }

    @Test void finalResponseWaitsUntilTheFileHasActuallyBeenMerged() throws Exception {
        ExecutorService heldPool = mock(ExecutorService.class);
        AtomicReference<Runnable> merge = new AtomicReference<>();
        when(heldPool.submit(any(Runnable.class))).thenAnswer(call -> {
            merge.set(call.getArgument(0));
            return CompletableFuture.completedFuture(null);
        });
        configure(new UpService(heldPool));
        assertTrue(part("film.bin", 3, 0, "first-").getResponse().getContentAsString().contains("chunk_received"));
        assertEquals(200, part("film.bin", 3, 1, "middle-").getResponse().getStatus());
        CountDownLatch written = new CountDownLatch(1);
        MockMultipartFile last = new MockMultipartFile("file", "film.bin", "application/octet-stream", "last".getBytes(StandardCharsets.UTF_8)) {
            @Override public void transferTo(File destination) throws IOException {
                super.transferTo(destination);
                written.countDown();
            }
        };
        CompletableFuture<MvcResult> response = CompletableFuture.supplyAsync(() -> {
            try {
                return mvc.perform(multipart("/upload").file(last).param("name", "film.bin")
                        .param("chunks", "3").param("chunk", "2")).andReturn();
            } catch (Exception error) { throw new CompletionException(error); }
        });
        try {
            assertTrue(written.await(5, TimeUnit.SECONDS));
            assertThrows(TimeoutException.class, () -> response.get(100, TimeUnit.MILLISECONDS));
            assertFalse(Files.exists(root.resolve("film.bin")));
        } finally {
            merge.get().run();
        }
        MvcResult result = response.get(5, TimeUnit.SECONDS);
        assertEquals(200, result.getResponse().getStatus());
        assertTrue(result.getResponse().getContentAsString().contains("completed"));
        assertEquals("first-middle-last", Files.readString(root.resolve("film.bin")));
        assertFalse(Files.exists(root.resolve("temp/film.bin")));
    }

    @Test void missingChunkReturnsFailureAndPreservesExistingFileThenAllowsRetry() throws Exception {
        Files.writeString(root.resolve("film.bin"), "original");
        assertEquals(200, part("film.bin", 3, 0, "a").getResponse().getStatus());
        MvcResult failed = part("film.bin", 3, 2, "c");
        assertEquals(500, failed.getResponse().getStatus());
        assertTrue(failed.getResponse().getContentAsString().contains("failed"));
        assertEquals("original", Files.readString(root.resolve("film.bin")));
        assertEquals(200, part("film.bin", 2, 0, "new-").getResponse().getStatus());
        MvcResult retry = part("film.bin", 2, 1, "file");
        assertEquals(200, retry.getResponse().getStatus());
        assertTrue(retry.getResponse().getContentAsString().contains("completed"));
        assertEquals("new-file", Files.readString(root.resolve("film.bin")));
    }

    @Test void destinationWriteFailureReturnsJsonFailure() throws Exception {
        Files.createDirectories(root.resolve("occupied"));
        Files.writeString(root.resolve("occupied/keep.txt"), "keep");
        mvc.perform(multipart("/upload").file(file("x")).param("name", "occupied"))
                .andExpect(status().isInternalServerError()).andExpect(jsonPath("$.status").value("failed"))
                .andExpect(jsonPath("$.message").isNotEmpty());
        assertEquals("keep", Files.readString(root.resolve("occupied/keep.txt")));
    }

    @Test void mergeDestinationFailureIsReportedByTheFinalRequest() throws Exception {
        Files.createDirectories(root.resolve("occupied"));
        Files.writeString(root.resolve("occupied/keep.txt"), "keep");
        assertEquals(200, part("occupied", 2, 0, "a").getResponse().getStatus());
        MvcResult failed = part("occupied", 2, 1, "b");
        assertEquals(500, failed.getResponse().getStatus());
        assertTrue(failed.getResponse().getContentAsString().contains("failed"));
        assertEquals("keep", Files.readString(root.resolve("occupied/keep.txt")));
    }

    @Test void absentSessionAndInvalidParametersCannotReturnSuccess() throws Exception {
        assertEquals(500, part("missing.bin", 2, 1, "b").getResponse().getStatus());
        assertEquals(400, part("bad.bin", 2, 2, "b").getResponse().getStatus());
        mvc.perform(multipart("/upload").file(file("x")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.status").value("failed"));
    }
}
