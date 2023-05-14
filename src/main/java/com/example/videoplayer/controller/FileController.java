package com.example.videoplayer.controller;

import com.example.videoplayer.service.DownService;
import com.example.videoplayer.service.UpService;
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

    //String id,  String type, String lastModifiedDate, int size,
    @PostMapping("/upload")
    public void upload(Integer chunks, Integer chunk, String name, MultipartFile file) {
//        upService.upload(chunks, chunk, name, file);
        upService.upload2(chunks, chunk, name, file);
    }

    @GetMapping("u")
    public String uploadPage() {
        return "upload";
    }

    @GetMapping("/f/**")
    public String filePage(HttpServletResponse response, HttpServletRequest request, Model model) {
        return downService.getFile(response, request, model);
    }

    @GetMapping("/v1/**")
    public String getVideo1(HttpServletResponse response, HttpServletRequest request) {
        return downService.getVideo(response, request);
    }

    @GetMapping("/v2/**")
    public String getVideo2(HttpServletRequest request, Model model) {
        String path = downService.gv2(request);
        model.addAttribute("filePath", path);
        return "video";
    }

    @GetMapping("/c")
    public String click(Model model) {
        String content = downService.getClipContent();
        model.addAttribute("content", content);
        return "click";
    }

    @GetMapping("/")
    public String basePage() {
        return "redirect:/f";
    }
}
