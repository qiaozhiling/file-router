package com.example.filerouter.service;

import com.example.filerouter.handler.NSRRH;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.ui.Model;
import org.springframework.util.FileCopyUtils;

import javax.servlet.ServletException;
import javax.servlet.ServletOutputStream;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.awt.*;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.Transferable;
import java.io.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Collator;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;
import java.util.Objects;

@Service
public class DownService extends RootService {

    @Autowired
    private NSRRH nsrrh;

    public String getFile(HttpServletResponse response, HttpServletRequest request, Model model) {
        try {
            String relate_path = request.getServletPath().replaceFirst("/f", "");
            String path = basePath + relate_path;
            File f = new File(path);
            if (!f.exists()) {
                return "404";
            } else if (f.isDirectory()) {
                File[] fs = f.listFiles();
                assert fs != null;
                Arrays.sort(fs, (o1, o2) -> Collator.getInstance(Locale.CHINA).compare(o1.getName(), o2.getName()));
                Arrays.sort(fs, Comparator.comparing(file -> !file.isDirectory()));
                String[] ns = new String[fs.length];
                for (int i = 0; i < Objects.requireNonNull(fs).length; i++) {
                    ns[i] = relate_path + "/" + fs[i].getName();
                }
                model.addAttribute("files", ns);
                model.addAttribute("size", ns.length);
                return "files";
            } else {
                ServletOutputStream op = response.getOutputStream();
                response.reset();
                response.setCharacterEncoding("utf-8");
                response.setHeader("Content-Disposition", "attachment;filename=" + URLEncoder.encode(f.getName(), StandardCharsets.UTF_8));
                response.setHeader("Content-Length", "" + f.length());
                FileInputStream fis = new FileInputStream(f);
                BufferedInputStream bis = new BufferedInputStream(fis);
                BufferedOutputStream bos = new BufferedOutputStream(op);
                FileCopyUtils.copy(bis, bos);
                bis.close();
                bos.close();
                op.close();
                fis.close();
                return null;
            }
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    public String getVideo(HttpServletResponse response, HttpServletRequest request) {
        try {
            String path = basePath + request.getServletPath().replaceFirst("/v1", "");
            File f = new File(path);
            if (f.exists() & !f.isDirectory()) {
                request.setAttribute(NSRRH.ATTR_FILE, path);
                nsrrh.handleRequest(request, response);
                return null;
            }
            return "404";
        } catch (IOException | ServletException e) {
            e.printStackTrace();
            return null;
        }
    }

    public String gv2(HttpServletRequest request) {
        return request.getServletPath().replaceFirst("v2", "v1");
//                .replaceAll("\\[", "%5B").replaceAll("]", "%5D")
    }
    public String getClipContent() {
        String ret = "";
        Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
        // 获取剪切板中的内容
        Transferable clipTf = clipboard.getContents(null);
        if (clipTf != null) {
            // 检查内容是否是文本类型
            if (clipTf.isDataFlavorSupported(DataFlavor.stringFlavor)) {
                try {
                    ret = (String) clipTf.getTransferData(DataFlavor.stringFlavor);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
        return ret;
    }
}