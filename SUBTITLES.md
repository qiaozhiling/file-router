# MP4 内封字幕

文件列表统一点击 **观看**（`/v1/文件路径`）。视频自动进入播放器，读取字幕并默认开启第一轨，可切换轨道或关闭。图片、音频、PDF 保留浏览器直接预览。

旧 `/v2/文件路径` 自动跳转到 `/v1/文件路径`。播放器通过独立的 `/media/文件路径` 获取原始媒体数据，保留 Range 分段请求和进度拖动。需要给其他播放器提供原始视频 URL 时，请使用 `/media/`。

## 启动

```powershell
mvn package
java -jar target/file-router-0.0.1-SNAPSHOT.jar
```

使用项目的 `application.yaml` 配置，默认端口为 `8081`。也可通过启动参数显式指定：

```powershell
java -jar target/file-router-0.0.1-SNAPSHOT.jar --server.port=8081
```

## 实现

- 使用 Java 依赖 `org.mp4parser:muxer:1.9.56` 定位和读取 MP4 的 `tx3g` 文本字幕样本，不依赖 FFmpeg，不修改原视频。
- `GET /api/subtitles?path=...` 返回字幕轨道的 ID、语言与名称，path 是相对 `file.basePath` 的文件路径，带前导 `/`。
- `GET /api/subtitles/track?path=...&track=...` 返回 UTF-8 WebVTT。查询参数应通过 URLSearchParams 或等效接口编码。
- 按样本时间、合成时间偏移和编辑列表生成时间轴，保留换行，转义字幕内的 HTML 标记。
- 浏览器使用原生 `<track>` 绘制字幕，支持 DPlayer 视频全屏。
- 统一管理视频的全部字幕轨道（包括浏览器识别的内封轨道），默认只显示第一条；切换后只显示选中轨道，关闭时禁用全部字幕，异步加载不会重新启用旧轨道。
- 最多缓存 8 个视频的转换结果，每个视频最多 4M 字符。缓存位于内存，重启后重新读取，视频大小或修改时间变化后自动失效。
- 字幕路径经规范化和真实路径检查，只能访问 `file.basePath` 内的文件。

## 当前范围

支持 MP4 内封 `tx3g` 文本字幕，已用实际视频的简体和繁体两轨验证。名称按语言和轨道序号显示；文件元数据未区分简繁时，不推测标签。

不保留原字幕的字体、颜色、特效和精确位置。不支持 ASS、PGS、VobSub、MKV 字幕或独立 SRT/ASS 文件；无兼容字幕时显示提示，读取失败不阻止视频播放。变速字幕编辑暂不支持。

## 验证

`mvn test` 包含字幕时间轴、空白间隔、UTF-16、文本转义、编辑列表、双轨读取、缓存更新、UTF-8 响应和目录越界检查。

`node src/test/js/subtitle-selection.test.cjs` 验证默认只显示一轨、延迟添加轨道、浏览器自动启用轨道、关闭字幕和快速切换后的异步加载。
