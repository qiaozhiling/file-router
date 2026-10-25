package com.example.filerouter.service;

import com.example.filerouter.utils.FileUtil;
import org.mp4parser.IsoFile;
import org.mp4parser.PropertyBoxParserImpl;
import org.mp4parser.boxes.iso14496.part12.CompositionTimeToSample;
import org.mp4parser.boxes.iso14496.part12.TrackBox;
import org.mp4parser.muxer.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;
import java.io.InputStream;
import java.io.FileInputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.FileTime;
import java.util.*;

/** Reads MP4 tx3g subtitle samples only, without rewriting or transcoding video. */
@Service
public class SubtitleService {
    private static final int MAX_TEXT_LENGTH = 4 * 1024 * 1024;
    // Bounded, in-memory LRU. File size and modification time invalidate stale entries.
    private final Map<Path, CachedSubtitles> cache = new LinkedHashMap<Path, CachedSubtitles>(16, .75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<Path, CachedSubtitles> eldest) { return size() > 8; }
    };

    public List<Subtitle> list(String path) throws IOException { return load(path); }

    public String webVtt(String path, long trackId) throws IOException {
        return load(path).stream().filter(s -> s.id == trackId).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "字幕轨道不存在")).vtt;
    }

    private Path resolve(String requestPath) throws IOException {
        if (requestPath == null || !requestPath.startsWith("/") || requestPath.contains("\\")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "无效的视频路径");
        }
        Path root = Paths.get(FileUtil.basePath).toRealPath();
        Path candidate = root.resolve(requestPath.substring(1)).normalize();
        if (!candidate.startsWith(root)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "视频路径超出文件目录");
        }
        if (!Files.isRegularFile(candidate)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "视频不存在");
        }
        Path real = candidate.toRealPath();
        if (!real.startsWith(root)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "视频路径超出文件目录");
        }
        return real;
    }

    private synchronized List<Subtitle> load(String path) throws IOException {
        Path file = resolve(path);
        if (!file.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".mp4")) return Collections.emptyList();
        BasicFileAttributes attrs = Files.readAttributes(file, BasicFileAttributes.class);
        CachedSubtitles previous = cache.get(file);
        if (previous != null && previous.size == attrs.size() && previous.modified.equals(attrs.lastModifiedTime())) {
            return previous.subtitles;
        }
        List<Subtitle> subtitles = new ArrayList<>();
        try (FileInputStream input = new FileInputStream(file.toFile());
             IsoFile iso = new IsoFile(input.getChannel(), boxParser());
             RandomAccessFile data = new RandomAccessFile(file.toFile(), "r")) {
            if (iso.getMovieBox() == null) throw new IOException("MP4 缺少 moov 元数据");
            FileRandomAccessSourceImpl source = new FileRandomAccessSourceImpl(data);
            int totalLength = 0;
            for (TrackBox box : iso.getMovieBox().getBoxes(TrackBox.class)) {
                if (box.getSampleTableBox() == null || box.getSampleTableBox().getSampleDescriptionBox() == null) continue;
                boolean text = box.getSampleTableBox().getSampleDescriptionBox().getBoxes().stream()
                        .anyMatch(entry -> "tx3g".equals(entry.getType()));
                if (!text) continue; // Exclude chapters, images, audio and video tracks.
                Track track = new Mp4TrackImpl(box.getTrackHeaderBox().getTrackId(), iso, source, file.toString());
                String vtt = convert(track);
                totalLength += vtt.length();
                if (totalLength > MAX_TEXT_LENGTH) throw new IOException("字幕内容过大");
                String language = track.getTrackMetaData().getLanguage();
                String label = languageLabel(language) + "（第 " + (subtitles.size() + 1) + " 轨）";
                subtitles.add(new Subtitle(track.getTrackMetaData().getTrackId(), label, language, vtt));
            }
        } catch (RuntimeException e) {
            throw new IOException("无法解析 MP4 字幕", e);
        }
        List<Subtitle> result = Collections.unmodifiableList(subtitles);
        cache.put(file, new CachedSubtitles(attrs, result));
        return result;
    }

    private static PropertyBoxParserImpl boxParser() throws IOException {
        // mp4parser's default uses the system class loader, which cannot see nested Boot JAR resources.
        Properties mapping = new Properties();
        try (InputStream resource = SubtitleService.class.getResourceAsStream("/isoparser2-default.properties")) {
            if (resource == null) throw new IOException("缺少 MP4 解析器配置");
            mapping.load(resource);
        }
        return new PropertyBoxParserImpl(mapping);
    }

    static String convert(Track track) throws IOException {
        long timescale = track.getTrackMetaData().getTimescale();
        if (timescale <= 0) throw new IOException("字幕时间基准无效");
        List<Sample> samples = track.getSamples();
        long[] durations = track.getSampleDurations();
        if (samples.size() != durations.length) throw new IOException("字幕样本时间表不匹配");
        StringBuilder vtt = new StringBuilder("WEBVTT\n\n");
        List<CompositionTimeToSample.Entry> composition = track.getCompositionTimeEntries();
        int entryIndex = 0, remaining = 0;
        long compositionOffset = 0, decodeTime = 0;
        for (int i = 0; i < durations.length; i++) {
            if (composition != null && !composition.isEmpty()) {
                if (remaining == 0) {
                    if (entryIndex >= composition.size()) throw new IOException("字幕合成时间表不完整");
                    CompositionTimeToSample.Entry entry = composition.get(entryIndex++);
                    remaining = entry.getCount();
                    compositionOffset = entry.getOffset();
                }
                remaining--;
            }
            double start = (decodeTime + compositionOffset) / (double) timescale;
            double end = (decodeTime + compositionOffset + durations[i]) / (double) timescale;
            decodeTime += durations[i];
            Sample sample = samples.get(i);
            if (!"tx3g".equals(sample.getSampleEntry().getType())) throw new IOException("字幕轨道混合了不支持的格式");
            if (sample.getSize() > 1024 * 1024) throw new IOException("字幕样本过大");
            String text = decodeText(sample.asByteBuffer());
            if (!text.trim().isEmpty()) {
                appendEdited(vtt, start, end, text, track.getEdits());
                if (vtt.length() > MAX_TEXT_LENGTH) throw new IOException("字幕内容过大");
            }
        }
        return vtt.toString();
    }

    static String decodeText(ByteBuffer sample) throws IOException {
        ByteBuffer bytes = sample.duplicate();
        if (bytes.remaining() < 2) throw new IOException("字幕样本缺少文本长度");
        int length = Short.toUnsignedInt(bytes.getShort());
        if (length > bytes.remaining()) throw new IOException("字幕文本长度无效");
        byte[] text = new byte[length];
        bytes.get(text); // Skip any following tx3g style boxes.
        boolean utf16 = length >= 2 && ((text[0] == (byte) 0xfe && text[1] == (byte) 0xff)
                || (text[0] == (byte) 0xff && text[1] == (byte) 0xfe));
        String decoded = new String(text, utf16 ? StandardCharsets.UTF_16 : StandardCharsets.UTF_8);
        return decoded.replace("\uFEFF", "").replace("\u0000", "")
                .replace("\r\n", "\n").replace('\r', '\n').trim();
    }

    private static void appendEdited(StringBuilder out, double start, double end, String text, List<Edit> edits)
            throws IOException {
        if (edits == null || edits.isEmpty()) { appendCue(out, start, end, text); return; }
        double movieTime = 0;
        for (Edit edit : edits) {
            if (edit.getMediaTime() != -1) {
                if (edit.getMediaRate() != 1 || edit.getTimeScale() <= 0) throw new IOException("暂不支持变速字幕轨道");
                double mediaStart = edit.getMediaTime() / (double) edit.getTimeScale();
                double clippedStart = Math.max(start, mediaStart);
                double clippedEnd = Math.min(end, mediaStart + edit.getSegmentDuration());
                if (clippedEnd > clippedStart) {
                    appendCue(out, movieTime + clippedStart - mediaStart, movieTime + clippedEnd - mediaStart, text);
                }
            }
            movieTime += edit.getSegmentDuration();
        }
    }

    private static void appendCue(StringBuilder out, double start, double end, String text) {
        long startMs = Math.max(0, Math.round(start * 1000)), endMs = Math.max(0, Math.round(end * 1000));
        if (endMs <= startMs) return;
        String escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replaceAll("\n[\t ]*\n", "\n\u200b\n");
        out.append(timestamp(startMs)).append(" --> ").append(timestamp(endMs)).append('\n')
                .append(escaped).append("\n\n");
    }

    private static String timestamp(long ms) {
        return String.format(Locale.ROOT, "%02d:%02d:%02d.%03d", ms / 3600000,
                ms / 60000 % 60, ms / 1000 % 60, ms % 1000);
    }

    private static String languageLabel(String language) {
        if ("zho".equals(language) || "chi".equals(language) || "zh".equals(language)) return "中文";
        if ("eng".equals(language)) return "英语";
        if ("jpn".equals(language)) return "日语";
        return language == null || "und".equals(language) ? "字幕" : language;
    }

    public static final class Subtitle {
        private final long id;
        private final String label, language, vtt;
        Subtitle(long id, String label, String language, String vtt) {
            this.id = id; this.label = label; this.language = language; this.vtt = vtt;
        }
        public long getId() { return id; }
        public String getLabel() { return label; }
        public String getLanguage() { return language; }
        // Intentionally no getter for vtt: list responses contain metadata only.
    }

    private static final class CachedSubtitles {
        final long size;
        final FileTime modified;
        final List<Subtitle> subtitles;
        CachedSubtitles(BasicFileAttributes attrs, List<Subtitle> subtitles) {
            size = attrs.size(); modified = attrs.lastModifiedTime(); this.subtitles = subtitles;
        }
    }
}
