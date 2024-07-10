package com.example.filerouter.controller;

import com.example.filerouter.service.ClickBoardService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseBody;

import javax.servlet.http.HttpServletResponse;

@Controller
public class ClickBoardController {
    @Autowired
    private ClickBoardService clickBoardService;

    @GetMapping("/c")
    public String click(Model model) {
        String[] ret = clickBoardService.getClipContent();
        model.addAttribute("type", ret[0]);
        model.addAttribute("content", ret[1]);
        return "click";
    }

    @PostMapping("/uptext")
    @ResponseBody
    public void uptext(String cont) {
        clickBoardService.uptext(cont);
    }

    @GetMapping("/cbpn") // click board picture name
    public void tpic(HttpServletResponse response) { // temp picture
        clickBoardService.getClickBoardPic(response);
    }
}