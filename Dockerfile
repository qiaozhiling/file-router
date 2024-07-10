FROM openjdk:15-jdk-alpine
COPY *.jar /app.jar
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app.jar"]
# 为 ENTRYPOINT 指令指定的程序提供默认参数
CMD ["--server.port=8080","--file.basePath=/usr/local/filerouter"]