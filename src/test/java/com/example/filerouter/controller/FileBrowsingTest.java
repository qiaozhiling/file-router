package com.example.filerouter.controller;

import com.example.filerouter.service.DownService;
import com.example.filerouter.utils.FileUtil;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.ui.ExtendedModelMap;

import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class FileBrowsingTest {
    @TempDir Path root;
    private String previousRoot;
    private final DownService service = new DownService();
    @BeforeEach void setup() { previousRoot = FileUtil.basePath; FileUtil.basePath = root.toString(); }
    @AfterEach void restore() { FileUtil.basePath = previousRoot; }

    @Test void rootUsesHomeAndOnlyBaseNamesWithRootRelativeLinks() throws Exception {
        Files.createDirectory(root.resolve("folder"));
        Files.write(root.resolve("film.mp4"), new byte[]{1});
        ExtendedModelMap model = new ExtendedModelMap();
        assertEquals("files", service.getFile(new MockHttpServletResponse(), "", model, false));
        assertEquals("首页", model.get("directoryName"));
        assertEquals("/", model.get("currentPath"));
        assertNull(model.get("parentPath"));
        assertEquals(List.of(Map.of("name", "首页", "path", "")), model.get("breadcrumbs"));
        assertArrayEquals(new String[]{"folder", "film.mp4"}, (String[]) model.get("displayNames"));
        assertArrayEquals(new String[]{"/folder", "/film.mp4"}, (String[]) model.get("files"));
    }

    @Test void nestedDirectorySeparatesLabelsFromPathsWithoutDecodingLiteralPercent() throws Exception {
        String path = "/番剧/huiye/中文 & + %20 # [test]";
        Path directory = Files.createDirectories(root.resolve(path.substring(1)));
        Files.write(directory.resolve("EP01 & % #.mp4"), new byte[]{1});
        ExtendedModelMap model = new ExtendedModelMap();
        assertEquals("files", service.getFile(new MockHttpServletResponse(), path + "/", model, false));
        assertEquals("中文 & + %20 # [test]", model.get("directoryName"));
        assertEquals(path, model.get("currentPath"));
        assertEquals("/番剧/huiye", model.get("parentPath"));
        assertEquals(List.of(Map.of("name", "首页", "path", ""),
                Map.of("name", "番剧", "path", "/番剧"),
                Map.of("name", "huiye", "path", "/番剧/huiye"),
                Map.of("name", "中文 & + %20 # [test]", "path", path)), model.get("breadcrumbs"));
        assertArrayEquals(new String[]{"EP01 & % #.mp4"}, (String[]) model.get("displayNames"));
        assertArrayEquals(new String[]{path + "/EP01 & % #.mp4"}, (String[]) model.get("files"));
    }

    @Test void emptyFirstLevelDirectoryStillOffersRootAsParent() throws Exception {
        Files.createDirectory(root.resolve("empty"));
        ExtendedModelMap model = new ExtendedModelMap();
        assertEquals("files", service.getFile(new MockHttpServletResponse(), "/empty", model, false));
        assertEquals("", model.get("parentPath"));
        assertEquals(0, ((String[]) model.get("files")).length);
        assertEquals("empty", model.get("directoryName"));
    }
}
