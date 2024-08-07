package com.example.filerouter.common;

import com.example.filerouter.utils.FileUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Enumeration;

@Component
public class CommandLineRunnerImpl implements CommandLineRunner {
    @Override
    public void run(String... args) throws SocketException {
        System.out.println("application start...");
        logger.info("serve start on: " + getLocalIp());
        logger.info("base path : " + FileUtil.basePath + ", use \"--file.basePath=path\" to alter base path");
    }

    private final Logger logger = LoggerFactory.getLogger(this.getClass());

    public static String getLocalIp() throws SocketException {
        Enumeration<NetworkInterface> allNetInterfaces = NetworkInterface.getNetworkInterfaces();
        while (allNetInterfaces.hasMoreElements()) {
            NetworkInterface netInterface = allNetInterfaces.nextElement();
            Enumeration<InetAddress> addresses = netInterface.getInetAddresses();
            while (addresses.hasMoreElements()) {
                InetAddress ip = addresses.nextElement();
                if (ip != null && ip.isSiteLocalAddress() && ip instanceof Inet4Address) {
                    String ipAddress = ip.getHostAddress();
                    if (ipAddress.endsWith("1")) {
                        continue;
                    }
                    return ipAddress;
                }
            }
        }
        return "127.0.0.1";
    }

}