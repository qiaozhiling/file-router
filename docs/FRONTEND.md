# 前端资源

[项目首页](../README.md) · [模块与架构](MODULES.md) · [接口说明](API.md) · [运行与维护](OPERATIONS.md)

上传页和剪贴板页使用原生 JavaScript，不再依赖 jQuery、WebUploader 或 Flash。
播放器和本地 libmedia 解码资源继续使用现有实现。

- `src/main/resources/static/file-browser.js`：手机面包屑展开和相对目录路径复制。
- `src/main/resources/static/upload.js`：批量队列、删除、上传进度、失败重传。
- `src/main/resources/static/clipboard.js`：异步提交文本与复制，兼容局域网 HTTP 的复制备用方式。
- `src/main/resources/static/video-player.js`：播放器接入、完整区域全屏、“不使用字幕”菜单及字幕状态、跳转兼容与销毁。
- `src/main/resources/static/mobile-player-controls.js`：手机单击、双击跳转、长按倍速、横滑与进度条拖动。
- `src/main/resources/static/mobile-player.css`：手机布局、提示层、字幕关闭状态和进度预览样式。

上传沿用 `/upload` 的 `name`、`file`、`chunks`、`chunk` 请求字段；后端返回 JSON 接收与完成回执。
小文件和空文件不带分片字段；大文件每片 1 MiB，先发送第 0 片，最多并发发送 4 个中间分片，
所有前置分片成功后再发最后一片触发合并。文件依次处理，避免同名文件同时占用后端合并任务。
首片和中间片必须收到 `chunk_received`；整文件或最后一片必须收到 `completed`。进度到 100% 时显示“正在保存 / 合并…”，确认保存后才显示“已上传”；失败原因直接显示在文件行下。
非最终请求的网络错误、超时及 HTTP 408/429/5xx 自动重试两次；明确的 `failed` 回执直接报告失败。最终请求不自动重试，避免响应丢失后重复提交；未收到完成确认时应先核对服务器文件。
点击“开始上传 / 重试”只重传失败或待上传文件，失败文件从第 0 片重新发送。
队列内拒绝重名文件；上传期间禁止新增或删除，离开页面会取消尚未完成的请求。
文件名使用文本节点显示，提交地址由 Thymeleaf 生成，支持应用上下文路径。

文件列表仅显示文件名；当前目录通过面包屑导航，首页代表配置的文件根目录。手机上可展开中间层级，完整相对路径放在路径详情中，可复制但不展示服务器磁盘路径。

## 播放器交互与字幕

播放器全屏包含外层容器中的视频、控制栏和提示层。长按约 0.45 秒进入临时 2 倍速；倍速生效后，移动手指不触发进度预览或跳转，松手或取消触摸恢复原倍速。提示在普通模式和全屏中均显示，背景为 50% 透明度。

横滑预览进度、松手提交跳转，进度条也支持轻点和拖动。画面上下滑动不调整亮度或音量；部分浏览器自身的视频手势可以独立生效。

字幕菜单增加“不使用字幕”，关闭后入口显示“字幕（关闭）”，选择任一轨道可重新启用。关闭状态保存在当前页面，播放和跳转后保持，刷新页面恢复默认。菜单重建时补充选项，退出时清理观察器和事件；不修改上游 libmedia 资源。具体操作见[视频与字幕专题](SUBTITLES.md)。

`templates/video.html` 对播放器脚本和样式使用 `v` 查询参数。修改相应资源时需同步更新版本，避免浏览器使用旧脚本或样式；已经打开的页面需要重新加载。

## 验证

```powershell
mvn test
node --test --test-isolation=none src/test/js/file-browser.test.cjs src/test/js/native-upload.test.cjs src/test/js/native-clipboard.test.cjs src/test/js/video-player.test.cjs src/test/js/mobile-player-controls.test.cjs
```

分片测试检查原始字节重组、首尾分片顺序、并发失败、重试与取消；队列测试检查失败后续传、
删除和文件名安全显示；剪贴板测试检查特殊字符编码、错误处理和复制备用方式。
播放器测试还覆盖字幕关闭与重新启用、播放和跳转后的状态保持、菜单重建与清理，以及全屏提示和长按移动不误触进度。
