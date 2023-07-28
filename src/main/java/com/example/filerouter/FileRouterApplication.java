package com.example.filerouter;

import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;

import java.net.SocketException;

@SpringBootApplication
public class FileRouterApplication {
    public static void main(String[] args) throws SocketException {
//        SpringApplication.run(FileRouterApplication.class, args);
        SpringApplicationBuilder builder = new SpringApplicationBuilder(FileRouterApplication.class);
        builder.headless(false).run(args);
    }
}
