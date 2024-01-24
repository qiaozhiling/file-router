package com.example.filerouter.service;

import com.example.filerouter.utils.FileUtil;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import javax.servlet.http.HttpServletResponse;
import java.awt.*;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.Transferable;
import java.awt.image.BufferedImage;
import java.io.File;


@Service
public class ClickBoardService extends RootService {

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
                    File file = new File(FileUtil.tempPath + "/" +FileUtil.clickBoardPicName);
                    FileUtil.checkDir(file);
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

    public void getClickBoardPic(HttpServletResponse response) {
        File f = new File(FileUtil.tempPath + "/" + FileUtil.clickBoardPicName);
        try {
            FileUtil.flushFile(response, f);
            f.delete();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public void uptext(String cont) {
        logger.info("upload text : " + cont);
    }

}