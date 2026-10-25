package com.example.filerouter.service;

import com.example.filerouter.controller.SubtitleController;
import com.example.filerouter.utils.FileUtil;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.mp4parser.muxer.Edit;
import org.mp4parser.muxer.Movie;
import org.mp4parser.muxer.builder.DefaultMp4Builder;
import org.mp4parser.muxer.tracks.TextTrackImpl;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class SubtitleServiceTest {
    @TempDir Path root;
    String previousRoot;
    SubtitleService service;
    MockMvc mvc;

    @BeforeEach void setup() {
        previousRoot = FileUtil.basePath;
        FileUtil.basePath = root.toString();
        service = new SubtitleService();
        mvc = MockMvcBuilders.standaloneSetup(new SubtitleController(service)).build();
    }

    @AfterEach void restore() { FileUtil.basePath = previousRoot; }

    private TextTrackImpl track(String text) {
        TextTrackImpl t = new TextTrackImpl();
        t.getTrackMetaData().setLanguage("zho");
        t.getSubs().add(new TextTrackImpl.Line(1200, 3450, text));
        t.getSubs().add(new TextTrackImpl.Line(5000, 6000, "第二句"));
        return t;
    }

    private Path movie(String name, String text, boolean twoTracks) throws IOException {
        Movie m = new Movie();
        m.addTrack(track(text));
        if (twoTracks) m.addTrack(track("繁體字幕"));
        Path file = root.resolve(name);
        try (FileChannel out = FileChannel.open(file, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE)) { new DefaultMp4Builder().build(m).writeContainer(out); }
        return file;
    }

    @Test void convertsTimingGapsAndEscapesMarkup() throws Exception {
        String vtt = SubtitleService.convert(track("中文 <标签> & test\n下一行"));
        assertTrue(vtt.startsWith("WEBVTT\n\n"));
        assertTrue(vtt.contains("00:00:01.200 --> 00:00:03.450\n中文 &lt;标签&gt; &amp; test\n下一行"));
        assertTrue(vtt.contains("00:00:05.000 --> 00:00:06.000\n第二句"));
        assertEquals(2, vtt.split(" --> ").length - 1);
    }

    @Test void appliesEmptyAndTrimEditsToMovieTimeline() throws Exception {
        TextTrackImpl t = track("内容");
        t.getEdits().add(new Edit(-1, 1000, 1, 2));
        t.getEdits().add(new Edit(2000, 1000, 1, 4));
        String vtt = SubtitleService.convert(t);
        assertTrue(vtt.contains("00:00:02.000 --> 00:00:03.450\n内容"));
        assertTrue(vtt.contains("00:00:05.000 --> 00:00:06.000\n第二句"));
    }

    @Test void decodesUtf16AndRejectsTruncatedSamples() throws Exception {
        byte[] text = "繁體".getBytes(StandardCharsets.UTF_16);
        ByteBuffer sample = ByteBuffer.allocate(text.length + 4).putShort((short) text.length).put(text).putShort((short) 0);
        sample.flip();
        assertEquals("繁體", SubtitleService.decodeText(sample));
        assertThrows(IOException.class, () -> SubtitleService.decodeText(ByteBuffer.wrap(new byte[]{0, 5, 1})));
    }

    @Test void readsTwoTracksAndInvalidatesCache() throws Exception {
        Path file = movie("视频[简&繁]+%#.mp4", "简体字幕", true);
        List<SubtitleService.Subtitle> first = service.list("/" + file.getFileName());
        assertEquals(2, first.size());
        assertTrue(service.webVtt("/" + file.getFileName(), first.get(0).getId()).contains("简体字幕"));
        assertTrue(service.webVtt("/" + file.getFileName(), first.get(1).getId()).contains("繁體字幕"));
        assertSame(first, service.list("/" + file.getFileName()));
        movie(file.getFileName().toString(), "新版字幕", false);
        Files.setLastModifiedTime(file, FileTime.fromMillis(System.currentTimeMillis() + 2000));
        List<SubtitleService.Subtitle> second = service.list("/" + file.getFileName());
        assertEquals(1, second.size());
        assertTrue(service.webVtt("/" + file.getFileName(), second.get(0).getId()).contains("新版字幕"));
    }

    @Test void servesUtf8MetadataAndVttWithPathChecks() throws Exception {
        movie("视频[简&繁].mp4", "中文内容", false);
        long id = service.list("/视频[简&繁].mp4").get(0).getId();
        mvc.perform(get("/api/subtitles").param("path", "/视频[简&繁].mp4"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(id))
                .andExpect(jsonPath("$[0].vtt").doesNotExist());
        mvc.perform(get("/api/subtitles/track").param("path", "/视频[简&繁].mp4").param("track", "" + id))
                .andExpect(status().isOk()).andExpect(content().contentType("text/vtt;charset=UTF-8"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("中文内容")));
        mvc.perform(get("/api/subtitles/track.vtt").param("path", "/视频[简&繁].mp4").param("track", "" + id))
                .andExpect(status().isOk()).andExpect(content().contentType("text/vtt;charset=UTF-8"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("中文内容")));
        mvc.perform(get("/api/subtitles").param("path", "/../outside.mp4")).andExpect(status().isForbidden());
        mvc.perform(get("/api/subtitles").param("path", "/missing.mp4")).andExpect(status().isNotFound());
        mvc.perform(get("/api/subtitles/track").param("path", "/视频[简&繁].mp4").param("track", "999"))
                .andExpect(status().isNotFound());
    }

    @Test void skipsUnsupportedTracksAndReturnsErrorForCorruptMp4() throws Exception {
        Path file = movie("chapters.mp4", "章节", false);
        byte[] bytes = Files.readAllBytes(file);
        int replaced = 0;
        for (int i = 0; i + 4 <= bytes.length; i++) {
            if (bytes[i] == 't' && bytes[i + 1] == 'x' && bytes[i + 2] == '3' && bytes[i + 3] == 'g') {
                System.arraycopy(new byte[]{'z', 'z', 'z', 'z'}, 0, bytes, i, 4);
                replaced++;
            }
        }
        assertEquals(1, replaced);
        Files.write(file, bytes);
        assertTrue(service.list("/chapters.mp4").isEmpty());
        Files.write(root.resolve("invalid.mp4"), new byte[0]);
        mvc.perform(get("/api/subtitles").param("path", "/invalid.mp4"))
                .andExpect(status().isUnprocessableEntity());
    }
}
