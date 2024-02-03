package com.example.filerouter.controller;

import com.example.filerouter.service.DownService;
import com.example.filerouter.service.UpService;
import org.apache.tomcat.util.http.fileupload.IOUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.ServletOutputStream;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.FileInputStream;
import java.io.IOException;

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
    public String getPreView1(HttpServletResponse response, HttpServletRequest request) {
        return downService.getPreView(response, request);
    }

    @GetMapping("/v2/**")
    public String getPreView2(HttpServletRequest request, Model model) {
        String path = downService.gv2(request);
        model.addAttribute("filePath", path);
        return "video";
    }

    @GetMapping("/")
    public String basePage() {
        return "redirect:/f";
    }
}
