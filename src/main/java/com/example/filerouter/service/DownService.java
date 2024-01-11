package com.example.filerouter.service;

import com.example.filerouter.handler.NSRRH;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.ui.Model;
import org.springframework.util.FileCopyUtils;

import javax.imageio.ImageIO;
import javax.servlet.ServletException;
import javax.servlet.ServletOutputStream;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.awt.*;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.Transferable;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Collator;
import java.util.*;

@Service
public class DownService extends RootService {

    @Autowired
    private NSRRH nsrrh;

    public String getFile(HttpServletResponse response, String requestPath, Model model, boolean delete) {
        try {
            String path = basePath + requestPath;
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
                    ns[i] = requestPath + "/" + fs[i].getName();
                }
                model.addAttribute("files", ns);
                model.addAttribute("size", ns.length);
                return "files";
            } else {
                flushFile(response, f);
                if (delete) {
                    f.delete();
                }
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

    public String[] getClipContent() {
        String type = "";
        String cont = "";
        Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
        Transferable clipTf = clipboard.getContents(null);
        try {
            if (clipTf != null) {
                if (clipTf.isDataFlavorSupported(DataFlavor.stringFlavor)) {// text content
                    type = "text";
                    cont = (String) clipTf.getTransferData(DataFlavor.stringFlavor);
                } else if (clipTf.isDataFlavorSupported(DataFlavor.imageFlavor)) {
                    type = "image";
                    BufferedImage image = (BufferedImage) clipTf.getTransferData(DataFlavor.imageFlavor);
                    File file = new File(tempPath + "/" + clickBoardPicName);
                    checkDir(file);
                    ImageIO.write(image, "png", file);
                    cont = "/cbpn"; // click board image route
                }
            }
        } catch (Exception e) {
            type = "";
            e.printStackTrace();
        }
        return new String[]{type, cont};
    }

    public void getClickBoardImg(HttpServletResponse response) {
        File f = new File(tempPath + "/" + clickBoardPicName);
        try {
            flushFile(response, f);
            f.delete();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void flushFile(HttpServletResponse response, File f) throws IOException {
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
    }
}