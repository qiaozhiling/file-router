package com.example.videoplayer;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;

import java.net.SocketException;

@SpringBootApplication
public class VideoplayerApplication {
    public static void main(String[] args) throws SocketException {
//        SpringApplication.run(VideoplayerApplication.class, args);
        SpringApplicationBuilder builder = new SpringApplicationBuilder(VideoplayerApplication.class);
        builder.headless(false).run(args);
    }
}
