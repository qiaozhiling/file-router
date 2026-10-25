# 前端资源

上传页和剪贴板页使用原生 JavaScript，不再依赖 jQuery、WebUploader 或 Flash。
播放器和本地 libmedia 解码资源继续使用现有实现。

- `src/main/resources/static/file-browser.js`：手机面包屑展开和相对目录路径复制。
- `src/main/resources/static/upload.js`：批量队列、删除、上传进度、失败重传。
- `src/main/resources/static/clipboard.js`：异步提交文本与复制，兼容局域网 HTTP 的复制备用方式。
- `src/main/resources/static/video-player.js`：播放器接入和字幕、跳转兼容。
- `src/main/resources/static/mobile-player-controls.js`：手机手势。

上传沿用 `/upload` 的 `name`、`file`、`chunks`、`chunk` 协议，以及后端异步合并语义。
小文件和空文件不带分片字段；大文件每片 1 MiB，先发送第 0 片，最多并发发送 4 个中间分片，
所有前置分片成功后再发最后一片触发合并。文件依次处理，避免同名文件同时占用后端合并任务。
网络错误、超时及 HTTP 408/429/5xx 自动重试两次；其他 HTTP 错误直接报告失败。
点击“开始上传 / 重试”只重传失败或待上传文件，失败文件从第 0 片重新发送。
队列内拒绝重名文件；上传期间禁止新增或删除，离开页面会取消尚未完成的请求。
文件名使用文本节点显示，提交地址由 Thymeleaf 生成，支持应用上下文路径。

验证：

```powershell
mvn test
node --test --test-isolation=none src/test/js/file-browser.test.cjs src/test/js/native-upload.test.cjs src/test/js/native-clipboard.test.cjs src/test/js/video-player.test.cjs src/test/js/mobile-player-controls.test.cjs
```

分片测试检查原始字节重组、首尾分片顺序、并发失败、重试与取消；队列测试检查失败后续传、
删除和文件名安全显示；剪贴板测试检查特殊字符编码、错误处理和复制备用方式。

文件列表仅显示文件名；当前目录通过面包屑导航，首页代表配置的文件根目录。手机上可展开中间层级，完整相对路径放在路径详情中，可复制但不展示服务器磁盘路径。
