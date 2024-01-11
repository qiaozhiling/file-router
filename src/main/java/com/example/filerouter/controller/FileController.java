package com.example.filerouter.controller;

import com.example.filerouter.service.DownService;
import com.example.filerouter.service.UpService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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

    @PostMapping("/upload")
    public void upload(Integer chunks, Integer chunk, String name, MultipartFile file) {
//        upService.upload(chunks, chunk, name, file);
        upService.upload2(chunks, chunk, name, file);
    }

    @PostMapping("/uptext")
    @ResponseBody
    public void uptext(String cont) {
        upService.uptext(cont);
    }

    @GetMapping("u")
    public String uploadPage() {
        return "upload";
    }

    @GetMapping("/f/**")
    public String filePage(HttpServletResponse response, HttpServletRequest request, Model model) {
        String requestPath = request.getServletPath().replaceFirst("/f", "");
        return downService.getFile(response, requestPath, model, false);
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
        String[] ret = downService.getClipContent();
        model.addAttribute("type", ret[0]);
        model.addAttribute("content", ret[1]);
        return "click";
    }

    @GetMapping("/cbpn")
    public void tpic(HttpServletResponse response) {
        downService.getClickBoardImg(response);
    }

    @GetMapping("/")
    public String basePage() {
        return "redirect:/f";
    }
}
