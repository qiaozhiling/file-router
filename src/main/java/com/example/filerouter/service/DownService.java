package com.example.filerouter.service;

import com.example.filerouter.handler.NSRRH;
import com.example.filerouter.utils.FileUtil;
import org.apache.catalina.connector.ClientAbortException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.ui.Model;

import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.File;
import java.io.IOException;
import java.math.BigInteger;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.text.Collator;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Comparator;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;


@Service
public class DownService extends RootService {
    private static final Pattern VIDEO = Pattern.compile(".*\\.(mp4|mkv|rmvb|avi|webm|m4v|mov)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern NAME_PART = Pattern.compile("[0-9]+|[^0-9]+");

    @Autowired
    private NSRRH nsrrh;

    public String getFile(HttpServletResponse response, String requestPath, Model model) {

        try {
            String path = FileUtil.basePath + requestPath;
            File f = new File(path);
            if (!f.exists()) {
                return "404";
            } else if (f.isDirectory()) {
                Path base = Paths.get(FileUtil.basePath).toAbsolutePath().normalize();
                Path directory = f.toPath().toAbsolutePath().normalize();
                if (!directory.startsWith(base)) return missing(response);
                String relative = base.relativize(directory).toString().replace(File.separatorChar, '/');
                String directoryPath = relative.isEmpty() ? "" : "/" + relative;
                List<Map<String, String>> breadcrumbs = new ArrayList<>();
                breadcrumbs.add(Map.of("name", "首页", "path", ""));
                String crumbPath = "";
                if (!relative.isEmpty()) {
                    for (String part : relative.split("/")) {
                        crumbPath += "/" + part;
                        breadcrumbs.add(Map.of("name", part, "path", crumbPath));
                    }
                }
                int parentSlash = directoryPath.lastIndexOf('/');
                model.addAttribute("breadcrumbs", breadcrumbs);
                model.addAttribute("directoryName", relative.isEmpty() ? "首页" : directory.getFileName().toString());
                model.addAttribute("currentPath", directoryPath.isEmpty() ? "/" : directoryPath);
                model.addAttribute("parentPath", parentSlash < 0 ? null : directoryPath.substring(0, parentSlash));
                File[] files = f.listFiles();
                if (files == null) return missing(response);
                Arrays.sort(files, (o1, o2) -> Collator.getInstance(Locale.CHINA).compare(o1.getName(), o2.getName()));
                Arrays.sort(files, Comparator.comparing(file -> !file.isDirectory()));
                String[] fileNames = new String[files.length];
                String[] displayNames = new String[files.length];
                boolean[] fileTypes = new boolean[files.length];
                for (int i = 0; i < Objects.requireNonNull(files).length; i++) {
                    fileTypes[i] = files[i].isDirectory();
                    fileNames[i] = directoryPath + "/" + files[i].getName();
                    displayNames[i] = files[i].getName();
                }
                model.addAttribute("files", fileNames);
                model.addAttribute("displayNames", displayNames);
                model.addAttribute("types", fileTypes);
                return "files";
            } else {
                FileUtil.flushFile(response, f);
                return null;
            }
        } catch (ClientAbortException e) {
            return null;
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    public String getPreView(HttpServletResponse response, HttpServletRequest request, Model model) {
        String path = request.getServletPath().substring("/v1".length());
        if (VIDEO.matcher(path).matches()) {
            try {
                if (resolveMedia(path) == null) return missing(response);
                model.addAttribute("filePath", path);
                model.addAttribute("mediaBase", request.getContextPath() + "/media");
                model.addAttribute("episodes", videoSiblings(path));
                return "video";
            } catch (IOException | IllegalArgumentException e) {
                return missing(response);
            }
        }
        // Images, audio and PDFs retain direct browser previews.
        return getMedia(response, request, path);
    }

    public String getMedia(HttpServletResponse response, HttpServletRequest request, String requestPath) {
        try {
            File f = resolveMedia(requestPath);
            if (f != null) {
                // Keep original video bytes seekable without persisting a browser media cache.
                if (VIDEO.matcher(requestPath).matches()) {
                    response.setHeader("Cache-Control", "no-store");
                }
                request.setAttribute(NSRRH.ATTR_FILE, f.getPath());
                nsrrh.handleRequest(request, response);
                return null;
            }
            return missing(response);
        } catch (ClientAbortException e) {
            return null;
        } catch (IllegalArgumentException e) {
            return missing(response);
        } catch (ServletException | IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    private List<Map<String, String>> videoSiblings(String requestPath) {
        List<Map<String, String>> episodes = new ArrayList<>();
        String parent = requestPath.substring(0, requestPath.lastIndexOf('/') + 1);
        try {
            Path root = Paths.get(FileUtil.basePath).toRealPath();
            File[] files = root.resolve(parent.substring(1)).normalize().toFile().listFiles();
            if (files != null) {
                for (File file : files) {
                    String path = parent + file.getName();
                    // Check every candidate, including symlinks, against the media root.
                    if (file.isFile() && VIDEO.matcher(file.getName()).matches()) {
                        try {
                            if (resolveMedia(path) != null) episodes.add(Map.of("name", file.getName(), "path", path));
                        } catch (IOException ignored) { /* A disappearing sibling must not prevent playback. */ }
                    }
                }
            }
        } catch (IOException | SecurityException ignored) { /* Keep the current video usable without a listing. */ }
        if (episodes.stream().noneMatch(item -> item.get("path").equals(requestPath))) {
            episodes.add(Map.of("name", requestPath.substring(requestPath.lastIndexOf('/') + 1), "path", requestPath));
        }
        Collator collator = Collator.getInstance(Locale.CHINA);
        episodes.sort((left, right) -> compareVideoNames(left.get("name"), right.get("name"), collator));
        return episodes;
    }

    private static int compareVideoNames(String left, String right, Collator collator) {
        Matcher a = NAME_PART.matcher(left), b = NAME_PART.matcher(right);
        while (true) {
            boolean hasA = a.find(), hasB = b.find();
            if (!hasA || !hasB) {
                if (hasA != hasB) return hasA ? 1 : -1;
                break;
            }
            String x = a.group(), y = b.group();
            int result = x.charAt(0) >= '0' && x.charAt(0) <= '9' && y.charAt(0) >= '0' && y.charAt(0) <= '9'
                    ? new BigInteger(x).compareTo(new BigInteger(y)) : collator.compare(x, y);
            if (result != 0) return result;
        }
        // Deterministic tie-breaker for names such as EP2 and EP02.
        int result = collator.compare(left, right);
        return result != 0 ? result : left.compareTo(right);
    }

    private File resolveMedia(String requestPath) throws IOException {
        if (!requestPath.startsWith("/") || requestPath.contains("\\")) return null;
        Path root = Paths.get(FileUtil.basePath).toRealPath();
        Path file = root.resolve(requestPath.substring(1)).normalize();
        if (!file.startsWith(root) || !file.toFile().isFile()) return null;
        Path real = file.toRealPath();
        return real.startsWith(root) ? real.toFile() : null;
    }

    private String missing(HttpServletResponse response) {
        response.setStatus(HttpServletResponse.SC_NOT_FOUND);
        return "404";
    }
}
