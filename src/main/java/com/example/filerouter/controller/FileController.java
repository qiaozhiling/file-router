package com.example.filerouter.controller;

import com.example.filerouter.service.DownService;
import com.example.filerouter.service.UpService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;

@Controller
public class FileController {

    @Autowired
    private UpService upService;

    @Autowired
    private DownService downService;

    @GetMapping("u")
    public String uploadPage() {
        return "upload";
    }

    @PostMapping("/upload")
    public ResponseEntity<Map<String, String>> upload(Integer chunks, Integer chunk, String name, MultipartFile file) {
        try {
            return ResponseEntity.ok(Map.of("status", upService.upload(chunks, chunk, name, file)));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(Map.of("status", "failed", "message", error.getMessage()));
        } catch (IOException error) {
            return ResponseEntity.status(500).body(Map.of("status", "failed", "message",
                    "文件保存或合并失败，请检查服务器磁盘空间、写入权限及日志后重试。"));
        }
    }

    @GetMapping("/f/**")
    public String filePage(HttpServletResponse response, HttpServletRequest request, Model model) {
        String requestPath = request.getServletPath().replaceFirst("/f", "");
        return downService.getFile(response, requestPath, model, false);
    }

    @GetMapping("/v1/**")
    public String getPreView1(HttpServletResponse response, HttpServletRequest request, Model model) {
        return downService.getPreView(response, request, model);
    }

    @GetMapping("/v2/**")
    public void getPreView2(HttpServletResponse response, HttpServletRequest request) {
        // Preserve the raw URL encoding, including literal %, #, Chinese and brackets in filenames.
        String context = request.getContextPath();
        String suffix = request.getRequestURI().substring(context.length() + "/v2".length());
        response.setStatus(HttpServletResponse.SC_FOUND);
        response.setHeader("Location", context + "/v1" + suffix);
    }

    @GetMapping("/media/**")
    public String media(HttpServletResponse response, HttpServletRequest request) {
        return downService.getMedia(response, request, request.getServletPath().substring("/media".length()));
    }

    @GetMapping("/")
    public String basePage() {
        return "redirect:/f";
    }
}
