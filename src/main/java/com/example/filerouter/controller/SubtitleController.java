package com.example.filerouter.controller;

import com.example.filerouter.service.SubtitleService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;
import java.util.List;

@RestController
public class SubtitleController {
    private final SubtitleService subtitles;
    private final Logger logger = LoggerFactory.getLogger(SubtitleController.class);
    public SubtitleController(SubtitleService subtitles) { this.subtitles = subtitles; }

    @GetMapping("/api/subtitles")
    public List<SubtitleService.Subtitle> list(@RequestParam("path") String path) {
        try { return subtitles.list(path); }
        catch (IOException e) { throw unavailable(e); }
    }

    @GetMapping(value = {"/api/subtitles/track", "/api/subtitles/track.vtt"}, produces = "text/vtt;charset=UTF-8")
    public ResponseEntity<String> track(@RequestParam("path") String path, @RequestParam("track") long track) {
        try {
            return ResponseEntity.ok().header("Cache-Control", "no-store")
                    .header("X-Content-Type-Options", "nosniff").body(subtitles.webVtt(path, track));
        } catch (IOException e) { throw unavailable(e); }
    }

    private ResponseStatusException unavailable(IOException e) {
        logger.warn("读取 MP4 内封字幕失败", e);
        return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "无法读取此视频的内封字幕", e);
    }
}
