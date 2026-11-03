# 运行与维护

[返回项目首页](../README.md)

## 环境与构建

- 项目基线为 Java 11、Spring Boot 2.5.7，具体依赖以 [`pom.xml`](../pom.xml) 为准。
- 使用已安装的 Maven。仓库未提供完整、受版本控制的 Maven Wrapper 配置，不以本机残留的 `mvnw` 为启动前提。
- Node.js 用于运行前端测试，JAR 的运行和页面访问不需要 Node.js 或 npm 构建。
- 剪贴板模块需要可访问的服务器桌面会话和 AWT 环境；文件服务本身使用本地磁盘。
- 共享根目录需预先存在，进程需有读取权限；上传和临时目录还需写入权限及足够空间。

在仓库根目录执行：

```powershell
mvn package
java -jar target/file-router-0.0.1-SNAPSHOT.jar --file.basePath=D:/Downloads --server.port=8081
```

构建失败时不要继续运行可能残留的旧 JAR。首次构建需要能访问 Maven 依赖仓库。

更新播放器脚本或样式时，应同步更新 `templates/video.html` 中对应资源的 `v` 查询参数。替换 JAR 后重新启动应用，并重新加载手机上已打开的播放页面；媒体响应的 `no-store` 不代表已加载的页面脚本会自动更新。

本机可能存在被 Git 忽略的生成文件 `HELP.md`，其中的 Java 17 / Spring Boot 3 链接不代表当前项目版本。

## 配置项

默认配置位于 [`application.yaml`](../src/main/resources/application.yaml)。启动时可用 `--属性名=值` 覆盖配置，例如：

```powershell
java -jar target/file-router-0.0.1-SNAPSHOT.jar '--file.basePath=D:/Shared Files' --server.port=8090
```

| 配置 | 当前默认值 | 作用 |
| --- | --- | --- |
| `file.basePath` | `D:/Downloads` | 文件浏览、下载与媒体读取的共享根目录 |
| `file.uploadDir` | `/uploads` | 与根目录拼接的上传目录后缀 |
| `file.tempDir` | `/temp` | 与上传目录拼接的临时目录后缀 |
| `file.clickBoardPicName` | `cbpn` | 剪贴板临时图片的文件名，无扩展名 |
| `server.port` | `8081` | 本地默认监听端口 |
| `spring.thymeleaf.cache` | `false` | 关闭模板缓存 |
| `spring.mvc.hiddenmethod.filter.enabled` | `true` | 启用隐藏 HTTP 方法过滤器 |

目录通过字符串拼接计算，不是三个相互独立的绝对路径：

```text
uploadPath = basePath + uploadDir
tempPath   = uploadPath + tempDir
```

建议 `basePath` 不以 `/` 结尾，两个目录后缀以 `/` 开头。默认布局：

```text
D:/Downloads/
└── uploads/
    ├── example.zip                 上传目标
    └── temp/
        ├── example.zip/
        │   └── 0-3-example.zip.tmp  分片示例
        └── cbpn                    剪贴板临时 PNG
```

临时目录位于共享根目录内部，目录浏览没有隐藏该目录的专门逻辑。文件根目录应只包含计划共享的内容。

### 请求体大小

当前 YAML 没有显式设置 multipart 大小限制。Spring Boot 2.5 系列默认单文件上限为 `1MB`、单请求上限为 `10MB`；这里限制的是每次请求中的文件/分片，不是最终合并文件总大小。

前端默认分片大小是 1 MiB。若修改分片大小或直接使用客户端上传较大的整文件，应相应配置限制，例如下面是可选启动参数，并非项目已修改的默认值：

```powershell
java -jar target/file-router-0.0.1-SNAPSHOT.jar --spring.servlet.multipart.max-file-size=2MB --spring.servlet.multipart.max-request-size=3MB
```

如果前面还有代理，还需检查代理请求体限制。multipart 请求会有表单额外开销，整个请求上限应大于文件分片大小。

配置说明通过 Context7 核对了 Spring Boot 2.5.x 官方资料；可检索版本为 2.5.3 / 2.5.5，项目实际依赖仍为 2.5.7。参考：[外部化配置](https://github.com/spring-projects/spring-boot/blob/v2.5.5/spring-boot-project/spring-boot-docs/src/docs/asciidoc/features/external-config.adoc)、[2.5.3 参考文档](https://docs.spring.io/spring-boot/docs/2.5.3/reference/htmlsingle)。

## Docker 现状

现有 [`Dockerfile`](../Dockerfile) 使用 `openjdk:15-jdk-alpine`，将构建上下文根目录的 `*.jar` 复制为 `/app.jar`。因此它不是直接从源码编译的多阶段构建；仅执行 `mvn package` 会把 JAR 放在 `target/`，不能自动满足根目录 `COPY *.jar` 的条件。构建上下文中应只有一个待复制的应用 JAR。

容器默认启动参数为：

```text
--server.port=8080
--file.basePath=/usr/local/filerouter
```

容器部署需准备该共享目录及持久卷，并映射容器的 8080 端口。本地 YAML 的 8081 不代表容器默认端口。该镜像还需要单独验证基础镜像可用性、文件读写权限和媒体访问；当前文档不表示已经完成容器实测。无桌面容器通常无法使用服务器系统剪贴板。

## 数据与运行状态

| 内容 | 位置 | 生命周期 |
| --- | --- | --- |
| 共享原文件 | `file.basePath` 下 | 文件系统持久保存 |
| 上传结果 | `uploadPath` 下 | 文件系统持久保存，存在同名覆盖风险 |
| 上传分片 | `tempPath/{name}` 下 | 合并后尝试删除，异常退出可能残留 |
| 上传任务索引 | `UpService` 内存 Map | 进程退出丢失，不会自动恢复任务 |
| MP4 字幕缓存 | `SubtitleService` 内存 LRU | 最多 8 个文件，重启清空 |
| 剪贴板图片 | `tempPath/cbpn` | 输出图片后尝试删除，共用一个文件名 |
| 浏览器播放缓冲 | 浏览器内存 | 页面退出销毁播放器，无应用级持久媒体缓存 |
| 字幕开关与当前轨道选择 | 浏览器当前播放器 | 当前页面的播放和跳转后保持；重新加载页面恢复默认选择 |

备份应覆盖需保留的共享文件和上传结果。清理临时分片前先停止相关上传并确认没有合并任务使用它们；当前没有独立任务查询或可靠的启动恢复清理机制。

## 测试与验证

后端自动化测试：

```powershell
mvn test
```

前端测试使用 Node.js 自带测试运行器，无 npm 安装步骤。下面沿用仓库专题文档的命令，需要支持 `--test-isolation=none` 且提供测试所需 `File` 等 Web API 的 Node.js 版本：

```powershell
node --test --test-isolation=none src/test/js/file-browser.test.cjs src/test/js/native-upload.test.cjs src/test/js/native-clipboard.test.cjs src/test/js/video-player.test.cjs src/test/js/mobile-player-controls.test.cjs
```

| 测试 | 主要覆盖 |
| --- | --- |
| `FileBrowsingTest` | 根目录、嵌套目录、面包屑、文件显示名和相对链接 |
| `PreviewRoutingTest` | 统一视频入口、原始媒体与 Range、旧链接、越界路径 |
| `SubtitleServiceTest` | 时间轴、编码、文本转义、双轨、缓存失效、字幕接口与路径校验 |
| `file-browser.test.cjs` | 手机路径展开、路径复制与备用方式 |
| `native-upload.test.cjs` | 分片字节、首尾顺序、并发、重试、取消、队列行为 |
| `native-clipboard.test.cjs` | 表单编码、错误处理、复制备用方式 |
| `video-player.test.cjs` | 播放器接入、全屏容器、字幕备用、不使用字幕与重新启用、菜单重建、MSE/WASM 跳转和状态恢复、销毁 |
| `mobile-player-controls.test.cjs` | 单双击、长按倍速及移动锁定、全屏提示、画面横滑和进度条拖动、竖滑不改变亮度/音量、方向锁定、控制栏、设置与手势取消 |

`src/test/java/filerouter/` 中还保留历史实验程序；其中多个类只有 `main()`，不能因为文件名以 `Test` 结尾就认为已纳入自动化测试。前端测试也不等于真实设备上的编解码兼容测试。

变更上传逻辑后，应额外核对上传目标与原文件大小/内容，并检查后台合并日志；变更播放器后，应使用真实视频验证拖动、字幕、音轨、手机操作及页面退出。

播放器真机回归应至少覆盖：

1. 普通模式与全屏长按时显示倍速提示，背景为 50% 透明度；手指横移、竖移或移到进度条区域均不提交跳转，松手恢复原倍速。
2. 松手后的新一次横滑，以及直接轻点和拖动进度条，仍可正常调整进度。
3. 字幕菜单选择“不使用字幕”后立即隐藏字幕；暂停后播放、MSE/WASM 跳转及全屏切换后保持关闭，选择原轨或其他轨道可重新启用。
4. 区分网页与浏览器原生视频手势。网页不处理竖滑亮度和音量；本次用户反馈 Via 自带相关全屏手势，Android Edge 未提供。

## 常见问题

| 现象 | 排查方向 |
| --- | --- |
| 局域网设备无法访问 | 实际 IP、监听端口、防火墙、网络隔离；多网卡时不要只依赖启动日志里的 IP |
| 列表为空或显示 404 页面 | 根目录是否存在、目录权限、URL 相对路径、是否启动了预期 JAR |
| 上传请求被拒绝 | multipart 限制、代理限制、分片大小和表单字段 |
| 页面提示完成但文件不完整 | 后台合并是否完成、`check ok` / `check fail` 日志、磁盘空间、同名任务冲突 |
| 上传中断后重试失败 | 临时分片和旧任务状态；当前没有可靠的上传会话隔离或断点恢复 |
| 剪贴板页面无内容 | 服务器是否有桌面会话、剪贴板内容类型、AWT 环境和服务器异常日志 |
| 提交文本后服务器剪贴板没变化 | 当前实现只记日志，这是尚未实现的写入功能 |
| 视频能打开但播放失败或卡顿 | 浏览器编码支持、WASM 性能、视频损坏、资源是否完整、网络读取速度 |
| 全屏没有倍速提示或长按移动仍触发跳转 | 核对运行的 JAR 和静态资源版本，重新加载页面；当前实现对完整播放器区域全屏，倍速生效后锁定触摸操作 |
| 字幕无法关闭 | 在字幕菜单选择“不使用字幕”；若文字已压制进视频画面，则不属于可关闭的独立字幕轨道 |
| 关闭字幕后刷新页面又显示 | 当前开关仅在页面内保存，重新加载页面恢复播放器默认选择 |
| 删除网页亮度、音量手势后全屏仍能调整 | 排查浏览器自带的视频增强手势；网页没有系统亮度接口或画面亮度滤镜 |
| Java 字幕接口返回空数组 | 文件是否为 MP4，是否包含 tx3g 文本轨道；其他字幕依赖播放器解析 |
| 字幕返回 422 | MP4 解析日志、文件损坏、字幕大小或不支持的时间轴特征 |
| 剪贴板图片刷新后失效 | 临时图片读取后被删除，重新打开 `/c` 生成；不是长期有效的资源链接 |

## 已知限制

以下根据当前实现整理，用于界定现有能力，不是已经完成的修复清单。

1. **访问权限**：没有登录、用户隔离或接口授权；能访问服务的客户端可以浏览共享内容、上传文件和请求剪贴板。部署范围应与这一能力边界一致。
2. **路径检查不统一**：媒体与字幕检查真实路径；`/f/**` 下载和上传文件名没有同等级的完整约束。不能把部分接口的校验理解为全站均已防止目录越界。
3. **上传身份与同名文件**：任务和临时目录以文件名标识，不同客户端可能发生冲突。直接保存和首片合并可能覆盖目标，失败清理还会尝试删除目标文件。
4. **上传完成与异常**：后台合并没有完成回执，部分 I/O 异常只被打印。当前缺少统一错误响应、内容校验和以及可靠的任务状态持久化。
5. **异常中断与清理**：重启丢失任务状态，可能留下临时分片或不完整文件；没有自动恢复承诺。
6. **剪贴板能力**：文本提交仅记录日志；图片共用临时文件，缺少客户端隔离；提交内容会进入日志，应考虑实际日志访问范围。
7. **预览格式**：支持进入播放器的文件扩展名不等于支持所有内部编码或字幕效果，尤其软件解码体验依赖设备性能。
8. **错误契约**：不同入口的异常处理不统一，例如部分缺失文件只返回错误页面而未设置相应 HTTP 状态。

建议优先完善路径校验、上传任务隔离与完成确认，再按使用需求补充访问控制和剪贴板写入。未来新增能力应同时更新接口、测试与使用说明。
