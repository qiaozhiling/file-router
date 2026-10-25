package com.example.filerouter.controller;

import com.example.filerouter.service.DownService;
import com.example.filerouter.service.UpService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

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
    public void upload(Integer chunks, Integer chunk, String name, MultipartFile file) {
        upService.upload(chunks, chunk, name, file);
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
