package com.example.filerouter.controller;

import com.example.filerouter.handler.NSRRH;
import com.example.filerouter.service.DownService;
import com.example.filerouter.utils.FileUtil;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockServletContext;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.net.URI;
import java.nio.file.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PreviewRoutingTest {
    @TempDir Path root;
    private String previousRoot;
    private MockMvc mvc;

    @BeforeEach void setup() throws Exception {
        previousRoot = FileUtil.basePath;
        FileUtil.basePath = root.toString();
        NSRRH resourceHandler = new NSRRH();
        resourceHandler.setServletContext(new MockServletContext());
        resourceHandler.afterPropertiesSet();
        DownService service = new DownService();
        ReflectionTestUtils.setField(service, "nsrrh", resourceHandler);
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "downService", service);
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
        Files.write(root.resolve("film.MP4"), new byte[]{0,1,2,3,4,5,6,7,8,9});
        Files.write(root.resolve("image.png"), new byte[]{1,2,3});
        Files.write(root.resolve("document.pdf"), new byte[]{4,5,6});
    }

    @AfterEach void restore() { FileUtil.basePath = previousRoot; }

    @Test void videoUsesPlayerAndSeparateMediaPath() throws Exception {
        mvc.perform(get("/v1/film.MP4").servletPath("/v1/film.MP4"))
                .andExpect(status().isOk()).andExpect(view().name("video"))
                .andExpect(model().attribute("filePath", "/film.MP4"))
                .andExpect(model().attribute("mediaBase", "/media"));
    }

    @Test void mediaPreservesRangeSeeking() throws Exception {
        mvc.perform(get("/media/film.MP4").servletPath("/media/film.MP4").header("Range", "bytes=2-5"))
                .andExpect(status().isPartialContent()).andExpect(header().string("Content-Range", "bytes 2-5/10"))
                .andExpect(content().bytes(new byte[]{2,3,4,5}));
    }

    @Test void imagesAndPdfKeepDirectPreview() throws Exception {
        mvc.perform(get("/v1/image.png").servletPath("/v1/image.png"))
                .andExpect(status().isOk()).andExpect(content().contentType("image/png"))
                .andExpect(content().bytes(new byte[]{1,2,3}));
        mvc.perform(get("/v1/document.pdf").servletPath("/v1/document.pdf"))
                .andExpect(status().isOk()).andExpect(content().contentType("application/pdf"));
    }

    @Test void oldV2RedirectPreservesEncodingAndContext() throws Exception {
        mvc.perform(get(URI.create("/app/v2/literal%2520%23%26%5B%5D.mp4"))
                .contextPath("/app"))
                .andExpect(status().isFound())
                .andExpect(header().string("Location", "/app/v1/literal%2520%23%26%5B%5D.mp4"));
    }

    @Test void rejectsMissingAndEscapingFiles() throws Exception {
        mvc.perform(get("/v1/missing.mp4").servletPath("/v1/missing.mp4"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/media/../outside.mp4").servletPath("/media/../outside.mp4"))
                .andExpect(status().isNotFound());
    }
}
