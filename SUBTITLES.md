# 统一视频播放与字幕

文件列表点击 **观看**，所有视频进入 `/v1/文件路径` 的同一个 libmedia AVPlayerUI 1.3.1
播放器，包括 MP4、MKV、WebM、M4V、MOV、AVI、RMVB。播放、拖动、音轨、字幕、倍速和全屏
使用同一套控件。旧 `/v2/` 链接继续跳转到 `/v1/`。

## 启动

```powershell
mvn package
java -jar target/file-router-0.0.1-SNAPSHOT.jar
```

默认端口为 **8081**，根目录由 `file.basePath` 配置。文件列表和上传页面保留原有优化 UI。

## 解码与缓存

JAR 只通过 `/media/文件路径` 发送原始文件，支持 HTTP Range。播放器根据实际音视频编码
及浏览器能力选择解码路径，不按扩展名拆成两个播放器：优先 MSE 原生解码，其次 WebCodecs，
必要时使用 WASM 软件解码。MSE 兼容的 MKV 也可以使用原生解码，不强制所有 MKV 软件解码。

无后端 FFmpeg 转码、MP4 中间文件或持久视频缓存。视频与字幕响应设置 `Cache-Control: no-store`，
播放过程只使用内存缓冲。退出页面销毁播放器。没有 Service Worker、Cache API、IndexedDB
或文件系统媒体存储。播放器脚本、动态模块和 WASM 都在 JAR 内，由本地应用提供。

MSE 模式直接使用原生管线拖动。单线程 WASM 模式拖动会重新初始化解码管线，从原始视频目标位置
重新读取，避免刷新解码器时卡住；会短暂等待，并恢复音量、倍速、音轨和字幕选择。
软件解码的流畅度取决于设备性能、编码、分辨率和码率，不保证任意编码都支持。

## 字幕

内封字幕由统一播放器解析和绘制，MP4 tx3g、MKV 字幕等共用播放器的字幕控件。
只显示当前选择的一轨；点击字幕开关可关闭或开启，在菜单中切换轨道，也可添加本机字幕文件。
字幕随播放器进入全屏。具体文本、图形字幕与特效支持范围取决于 libmedia 的解码模块。
已用真实 MP4 的简体、繁体两轨验证读取、播放和切换。

保留原 Java MP4 tx3g 提取接口作为兼容备用。只有播放器未识别任何内封字幕时，MP4 才尝试调用，
避免字幕列表出现重复轨道。Java 解析结果使用有界内存缓存，不写视频目录或磁盘缓存。

- `GET /api/subtitles?path=...`：字幕 ID、语言、名称。
- `GET /api/subtitles/track?path=...&track=...`：原有 UTF-8 WebVTT 接口。
- `GET /api/subtitles/track.vtt?path=...&track=...`：同一 WebVTT 内容，供统一播放器识别格式。

查询参数使用 URLSearchParams 编码。Java 接口仅提取 MP4 tx3g，字体、颜色、位置和特效不保留；
ASS、PGS、MKV 等由播放器自己的模块处理。字幕失败有提示，视频仍可播放。
媒体与 Java 字幕接口检查真实路径，只能读取 `file.basePath` 内文件。

## 手机操作

竖屏按视频比例显示，横屏适配屏幕。轻点画面显示或隐藏控制栏，播放时自动隐藏。
单击等待约 0.3 秒以区分双击；双击左半边快退 2 秒，右半边快进 2 秒，跳转限制在视频时长内。
长按约 0.45 秒临时以 2 倍速播放，松手或切到后台恢复原倍速；滑动和控件操作不触发倍速。
点击设置按钮打开，再次点击或点击弹窗右上角 × 关闭。播放器区域关闭浏览器触摸高亮。

## 验证

```powershell
mvn test
node --test --test-isolation=none src/test/js/video-player.test.cjs src/test/js/mobile-player-controls.test.cjs
```

后端验证字幕时间轴、编辑列表、文本转义、UTF-16、双轨读取、缓存失效、路径越界、
WebVTT 新旧地址和 no-store、原始 MKV 字节与 Range。
前端验证全格式同一入口、特殊文件名、原生 MSE 优先、本地 WASM、内封字幕不重复、
Java 字幕兼容备用、MSE/WASM 拖动分流、音轨与字幕设置恢复、暂停跳转、错误提示与销毁，以及手机单击、双击跳转、长按倍速、设置弹窗关闭和手势取消。

上游版本、来源、许可证与资源 SHA256 见 `src/main/resources/static/libmedia/NOTICE.md`、
`COPYING.LGPLv3`、`COPYING.GPLv3`、`manifest.json`。
上游源码及构建说明：https://github.com/zhaohappy/libmedia/tree/v1.3.1 。
WASM 解码模块包含 FFmpeg 代码，本应用不再包含或运行 FFmpeg 本地可执行程序。
