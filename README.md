# File Router

File Router 是一个面向局域网文件共享的 Java Web 应用，可通过浏览器浏览和下载服务器文件、上传文件、预览媒体，以及查看服务器系统剪贴板。视频在浏览器中解码播放，服务端提供原始文件和 MP4 文本字幕备用接口。

Java 应用采用单个 Maven 工程；下文的“模块”指业务功能划分，并非 Maven 子模块。可选的 Python 公网发现服务独立部署。实现说明以当前源码为准。

## 功能概览

| 模块 | 当前功能 | 入口 |
| --- | --- | --- |
| 文件浏览与下载 | 目录列表、中文名称排序、目录优先、面包屑导航、相对路径复制、文件下载 | `/`、`/f/**` |
| 文件上传 | 批量队列、1 MiB 分片、进度显示、失败重试、后台合并 | `/u`、`POST /upload` |
| 文件预览与视频播放 | 图片、音频、PDF 浏览器预览；统一视频播放器、音轨、倍速、全屏、手机手势 | `/v1/**`、`/media/**` |
| 字幕 | 播放器内封字幕、本机字幕文件、Java MP4 tx3g 转 WebVTT 备用接口 | `/api/subtitles` |
| 剪贴板 | 读取服务器剪贴板文本或图片，将显示的文本复制到访问者剪贴板 | `/c`、`/cbpn` |
| 配置与公共组件 | 文件根目录与临时路径管理、启动日志、文件响应、上传合并任务 | `common`、`utils`、`handler` |
| 可选公网服务发现 | JAR 上报 Wi-Fi、以太网等多个地址，固定网页提供直达入口，JSON 保存单服务状态 | `discovery`、`discovery-server/` |

注意：`POST /uptext` 当前只将收到的文本写入服务器日志，尚未写入服务器系统剪贴板。上传请求返回也不代表后台分片合并已经成功。

## 文档导航

- [模块与架构](docs/MODULES.md)：各模块职责、源码位置、依赖关系、关键流程与扩展位置。
- [接口说明](docs/API.md)：页面路由、请求参数、响应行为、上传协议与字幕接口。
- [运行与维护](docs/OPERATIONS.md)：启动、配置、存储、Docker 现状、测试、故障排查和已知限制。
- [前端专题](docs/FRONTEND.md)：原生 JavaScript 上传、复制与目录导航行为。
- [视频与字幕专题](docs/SUBTITLES.md)：播放器、解码、字幕、缓存和手机操作。
- [公网服务发现](docs/DISCOVERY.md)：Python 服务部署、JAR 上报参数、JSON 状态与跨网段访问。

## 技术组成

| 技术 | 项目中的用途与版本 |
| --- | --- |
| Java | `pom.xml` 声明 Java 11 编译目标 |
| Spring Boot | 2.5.7，提供应用启动、Web 请求处理和配置绑定 |
| Thymeleaf | 服务端渲染 HTML 页面，依赖为 `thymeleaf-spring5` |
| 原生 JavaScript / CSS | 页面交互，无独立前端打包工程 |
| libmedia AVPlayerUI | 1.3.1，播放器和本地 WASM 解码资源 |
| mp4parser | `muxer` 1.9.56，用于 MP4 tx3g 字幕提取 |
| 可选 Python 发现服务 | Python 3.10+；FastAPI 0.162.0、Pydantic 2.14.2、Uvicorn 0.54.0，独立于 JAR 安装 |

当前没有数据库、Redis、消息队列或对象存储依赖。文件保存在本地文件系统，上传任务和字幕缓存保存在进程内存中。

## 快速开始

准备 JDK 11 和 Maven，并确保共享目录存在。以下命令在仓库根目录的 PowerShell 中执行；路径按实际情况替换：

```powershell
mvn package
java -jar target/file-router-0.0.1-SNAPSHOT.jar --file.basePath=D:/Downloads --server.port=8081
```

若 Maven 构建失败，先解决错误，再运行 JAR，避免启动旧产物。

启动后访问：

- 文件列表：<http://localhost:8081/f>
- 上传页面：<http://localhost:8081/u>
- 剪贴板页面：<http://localhost:8081/c>

局域网设备使用服务器实际 IP 替换 `localhost`。上传默认落到 `D:/Downloads/uploads`。更多参数与环境要求见[运行与维护](docs/OPERATIONS.md)。

需要固定入口时，可在公网服务器运行 [`discovery-server/server.py`](discovery-server/server.py)，然后给 JAR 添加 `--discovery.server-url=https://你的入口域名`。默认每 300 秒上报，IP 变化提前上报；`--discovery.report-interval-seconds=-1` 关闭全部上报。该功能默认不启用，不代理文件和视频。

Python 部署只需 `server.py` 和 `requirements.txt`；虚拟环境、SSH 后台运行及双网卡升级步骤见[公网服务发现](docs/DISCOVERY.md)。说明与测试保留在仓库，不放入部署包。

当前没有应用级登录和权限隔离，适用范围应限定在可信访问环境；具体实现限制见[已知限制](docs/OPERATIONS.md#已知限制)。

## 仓库结构

```text
file-router/
├── pom.xml                     Maven 依赖和构建配置
├── Dockerfile                  现有容器构建入口
├── docs/                       模块、接口、运行维护文档
├── discovery-server/           可选 Python 公网入口程序与依赖（两个文件）
├── src/main/java/com/example/filerouter/
│   ├── FileRouterApplication.java
│   ├── controller/             页面路由与接口
│   ├── discovery/              可选 HTTP 地址上报、网卡检测
│   ├── service/                文件、上传、剪贴板、字幕业务
│   ├── common/                 配置、启动日志、分片合并任务
│   ├── handler/                文件资源响应处理器
│   └── utils/                  路径与文件流工具
├── src/main/resources/
│   ├── application.yaml        默认配置
│   ├── templates/              Thymeleaf 页面
│   └── static/                 JavaScript、CSS、图片和 libmedia 资源
└── src/test/
    ├── java/                   后端自动化测试及历史实验程序
    ├── js/                     前端 Node.js 测试
    └── python/                 公网发现服务测试与测试依赖
```

## 还可以补充哪些文档

以下是后续文档建议。优先级按当前项目的维护需要排列。

| 优先级 | 建议内容 | 要回答的问题 |
| --- | --- | --- |
| 高 | 带截图的用户操作指南 | 如何上传、下载、切换字幕、使用手机手势？失败后如何处理？ |
| 高 | 发布记录与升级指南 | 每版变更了什么？旧链接是否兼容？如何回退到上一版？ |
| 高 | 访问控制与路径校验设计 | 谁可以读取、上传文件或查看剪贴板？各入口如何限制路径？ |
| 中 | 上传可靠性设计 | 如何识别上传任务、处理同名冲突、确认合并完成、恢复中断任务？ |
| 中 | 浏览器与设备兼容矩阵 | 哪些浏览器、编码、字幕格式和设备经过实测？测试样本是什么？ |
| 中 | 性能与容量报告 | 上传吞吐、并发请求、磁盘空间、内存占用和播放体验表现如何？ |
| 中 | 部署与备份手册 | 如何部署为服务、配置访问入口、备份上传文件、处理磁盘不足？ |
| 中 | 贡献与变更检查清单 | 新功能应改哪些层、补哪些测试、更新哪些文档？ |
| 低 | 架构决策记录（ADR） | 为什么采用浏览器解码、本地播放器资源和 Java 字幕备用方案？ |

当前无需编写数据库表结构文档；更有用的是维护文件目录布局、内存状态、接口契约和失败处理说明。

## 第三方资源

播放器资源的来源、版本、许可证和校验值见 [libmedia NOTICE](src/main/resources/static/libmedia/NOTICE.md) 及同目录许可证、`manifest.json`。修改或分发这些资源时应同步维护对应说明。
