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
import java.text.Collator;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;
import java.util.Objects;


@Service
public class DownService extends RootService {

    @Autowired
    private NSRRH nsrrh;

    public String getFile(HttpServletResponse response, String requestPath, Model model, boolean delete) {

        try {
            String path = FileUtil.basePath + requestPath;
            File f = new File(path);
            if (!f.exists()) {
                return "404";
            } else if (f.isDirectory()) {
                File[] files = f.listFiles();
                assert files != null;
                Arrays.sort(files, (o1, o2) -> Collator.getInstance(Locale.CHINA).compare(o1.getName(), o2.getName()));
                Arrays.sort(files, Comparator.comparing(file -> !file.isDirectory()));
                String[] fileNames = new String[files.length];
                boolean[] fileTypes = new boolean[files.length];
                for (int i = 0; i < Objects.requireNonNull(files).length; i++) {
                    fileTypes[i] = files[i].isDirectory();
                    fileNames[i] = requestPath + "/" + files[i].getName();
                }
                model.addAttribute("files", fileNames);
                model.addAttribute("types", fileTypes);
                return "files";
            } else {
                FileUtil.flushFile(response, f);
                if (delete) {
                    f.delete();
                }
                return null;
            }
        } catch (ClientAbortException e) {
            return null;
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    public String getPreView(HttpServletResponse response, HttpServletRequest request) {
        try {
            String path = FileUtil.basePath + request.getServletPath().replaceFirst("/v1", "");
            File f = new File(path);
            if (f.exists() & !f.isDirectory()) {
                request.setAttribute(NSRRH.ATTR_FILE, path);
                nsrrh.handleRequest(request, response);
                return null;
            }
            return "404";
        } catch (ClientAbortException e) {
            return null;
        } catch (ServletException | IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    public String gv2(HttpServletRequest request) {
        return request.getServletPath().replaceFirst("v2", "v1");
//                .replaceAll("\\[", "%5B").replaceAll("]", "%5D")
    }
}