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
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import static org.junit.jupiter.api.Assertions.*;
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
        Files.write(root.resolve("film.mkv"), new byte[]{0x1a,0x45,(byte)0xdf,(byte)0xa3,4,5,6,7,8,9});
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

    @SuppressWarnings("unchecked")
    @Test void playlistContainsOnlySameDirectoryVideosInNaturalOrder() throws Exception {
        Path series = Files.createDirectory(root.resolve("series"));
        for (String name : List.of("EP10.mkv", "EP2.MP4", "EP1.webm", "EP99999999999999999999999.mp4", "cover.jpg", "notes.txt")) {
            Files.write(series.resolve(name), new byte[]{1});
        }
        Files.createDirectory(series.resolve("folder.mp4"));
        Files.write(Files.createDirectory(series.resolve("sub")).resolve("EP3.mp4"), new byte[]{1});
        var result = mvc.perform(get("/v1/series/EP2.MP4").servletPath("/v1/series/EP2.MP4"))
                .andExpect(status().isOk()).andExpect(view().name("video")).andReturn();
        List<Map<String, String>> episodes = (List<Map<String, String>>) result.getModelAndView().getModel().get("episodes");
        assertEquals(List.of("EP1.webm", "EP2.MP4", "EP10.mkv", "EP99999999999999999999999.mp4"),
                episodes.stream().map(item -> item.get("name")).collect(Collectors.toList()));
        assertEquals("/series/EP2.MP4", episodes.get(1).get("path"));
    }

    @SuppressWarnings("unchecked")
    @Test void playlistPreservesSpecialFilenamesAndContextPath() throws Exception {
        String name = "第 2 集 & %#.mp4";
        Files.write(root.resolve(name), new byte[]{1});
        var result = mvc.perform(get(new URI(null, null, "/app/v1/" + name, null, null)).contextPath("/app")
                .with(request -> { request.setServletPath("/v1/" + name); return request; }))
                .andExpect(status().isOk()).andExpect(model().attribute("mediaBase", "/app/media")).andReturn();
        List<Map<String, String>> episodes = (List<Map<String, String>>) result.getModelAndView().getModel().get("episodes");
        assertTrue(episodes.contains(Map.of("name", name, "path", "/" + name)));
    }

    @SuppressWarnings("unchecked")
    @Test void singleVideoProducesAOneItemPlaylist() throws Exception {
        Path folder = Files.createDirectory(root.resolve("single"));
        Files.write(folder.resolve("only.mp4"), new byte[]{1});
        var result = mvc.perform(get("/v1/single/only.mp4").servletPath("/v1/single/only.mp4"))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, String>> episodes = (List<Map<String, String>>) result.getModelAndView().getModel().get("episodes");
        assertEquals(List.of(Map.of("name", "only.mp4", "path", "/single/only.mp4")), episodes);
    }

    @SuppressWarnings("unchecked")
    @Test void playlistExcludesSymlinksOutsideTheSharedRoot(@TempDir Path outside) throws Exception {
        Path secret = Files.write(outside.resolve("secret.mp4"), new byte[]{1});
        try { Files.createSymbolicLink(root.resolve("external.mp4"), secret); }
        catch (UnsupportedOperationException | java.io.IOException | SecurityException e) {
            Assumptions.assumeTrue(false, "Symbolic links unavailable: " + e.getMessage());
        }
        var result = mvc.perform(get("/v1/film.MP4").servletPath("/v1/film.MP4"))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, String>> episodes = (List<Map<String, String>>) result.getModelAndView().getModel().get("episodes");
        assertFalse(episodes.stream().anyMatch(item -> item.get("name").equals("external.mp4")));
    }

    @Test void originalMkvIsSeekableAndCannotBePersistentlyCached() throws Exception {
        mvc.perform(get("/media/film.mkv").servletPath("/media/film.mkv"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().bytes(Files.readAllBytes(root.resolve("film.mkv"))));
        mvc.perform(get("/media/film.mkv").servletPath("/media/film.mkv").header("Range", "bytes=4-7"))
                .andExpect(status().isPartialContent()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Content-Range", "bytes 4-7/10"))
                .andExpect(content().bytes(new byte[]{4,5,6,7}));
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
