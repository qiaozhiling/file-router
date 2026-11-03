# 公网文件服务入口

[返回项目首页](../README.md)

这是独立运行的 Python 程序：JAR 主动上报最新访问地址列表，手机访问固定的公网入口，再选择地址直接连接 JAR。Wi-Fi 和以太网同时启用时，可以分别显示两个入口。视频和文件不经过此服务器；此程序不提供代理、内网穿透或局域网扫描。

按当前单服务实验的约定，不设登录、密钥和设备 ID；任何能请求上报接口的人都能覆盖地址。页面不会自动跳转，显示地址后由用户点击打开。

## 文件布局

部署目录和部署压缩包只包含两个文件：

```text
discovery-server/
├── server.py          服务程序和入口页面
└── requirements.txt   Python 运行依赖
```

使用说明位于本文，测试与测试依赖位于仓库 `src/test/python/`，无需上传服务器。首次有效上报后自动生成 `devices.json`；虚拟环境 `.venv/`、后台运行日志和 PID 文件属于运行时文件，不包含在部署包中。

运行依赖锁定在 `requirements.txt`：FastAPI 0.162.0、Pydantic 2.14.2、Uvicorn 0.54.0。JAR 使用已有 Java 11 HTTP 客户端，不增加运行依赖。

## 安装与启动

需要 Python 3.10 或更新版本，推荐 Python 3.12。将 `server.py` 和 `requirements.txt` 复制到公网服务器，例如 `~/discovery-server`。Linux 下执行：

```sh
cd ~/discovery-server
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py --host 0.0.0.0 --port 8000
```

访问 `http://公网服务器IP:8000/`。Windows 下相应使用 `.venv\Scripts\python.exe`。

Ubuntu/Debian 创建虚拟环境时若提示缺少 `venv` 或 `ensurepip`，先安装对应 Python 版本的 `venv` 包；使用系统默认 `python3` 时通常为 `sudo apt install python3-venv`。

启动参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--host` | `0.0.0.0` | 监听地址；配置同机反向代理时可设为 `127.0.0.1` |
| `--port` | `8000` | 监听端口 |
| `--data-file` | `server.py` 所在目录的 `devices.json` | 保存路径；目录自动创建，需要写入权限 |

只有收到第一次有效上报后才生成 `devices.json`。每次覆盖最新状态，使用锁、同目录临时文件和原子替换；保存失败返回 HTTP 503，继续保留先前记录。JSON 损坏时明确启动失败并保留原文件，可修复该文件，或备份后移走再启动。

### SSH 后台运行

如果已经在前台运行，先按 `Ctrl+C` 停止，再执行：

```sh
cd ~/discovery-server
nohup .venv/bin/python -u server.py --host 0.0.0.0 --port 8000 >> server.log 2>&1 < /dev/null &
echo $! > server.pid
```

关闭 SSH 后仍继续运行。无需先激活虚拟环境，命令直接使用 `.venv` 中的解释器。查看日志：

```sh
tail -f ~/discovery-server/server.log
```

查看日志时按 `Ctrl+C` 只结束查看。需要停止服务时，在该目录核对保存的进程并停止：

```sh
cd ~/discovery-server
ps -p "$(cat server.pid)" -o pid,args
kill "$(cat server.pid)"
```

`nohup` 不提供开机启动或崩溃重启；需要时使用后文的 systemd 配置。

## 配置 JAR

例如 Python 服务直接监听公网 8000 端口：

```sh
java -jar file-router-0.0.1-SNAPSHOT.jar --discovery.server-url=http://公网服务器IP:8000 --discovery.report-interval-seconds=300
```

如果已有 HTTPS 域名入口，使用 `--discovery.server-url=https://你的域名`。这里填写入口根 URL，程序会追加 `/api/heartbeat`，不要重复填写该接口路径。

Windows 批处理示例，保留第一个参数覆盖共享目录的行为，替换 `REPORT_SERVER` 后使用：

```bat
@echo off
setlocal
set "REPORT_SERVER=http://你的公网IP:8000"
set "REPORT_INTERVAL=300"
cd /d "D:\Program Files\Java\jre-17.0.2\bin"
if "%~1"=="" (
    java -jar "D:\MyFile\file-router-0.0.1-SNAPSHOT.jar" "--discovery.server-url=%REPORT_SERVER%" "--discovery.report-interval-seconds=%REPORT_INTERVAL%"
) else (
    java -jar "D:\MyFile\file-router-0.0.1-SNAPSHOT.jar" "--file.basePath=%~1" "--discovery.server-url=%REPORT_SERVER%" "--discovery.report-interval-seconds=%REPORT_INTERVAL%"
)
endlocal
```

| JAR 配置 | 默认值 | 行为 |
| --- | --- | --- |
| `discovery.server-url` | 空 | 留空关闭所有上报 |
| `discovery.report-interval-seconds` | `300` | 正数为心跳间隔，单位秒；任何负数关闭全部上报，`0` 为配置错误 |
| `discovery.address` | 空 | 可选，手动覆盖为一个完整 HTTP(S) 访问地址；留空自动上报多个本地 IPv4，带实际端口和上下文路径 |

启动成功后立即后台上报。每隔最多 30 秒在本机枚举网卡，发现地址变化立即上报；地址不变时按配置心跳间隔上报。失败时按最多 30 秒的间隔重试（配置小于 30 秒则使用配置值）；连续失败不重复输出 WARN，成功恢复时记录日志。连接超时 3 秒、单次请求超时 5 秒。

网卡检查本身只在本机进行，不向公网发送心跳；多个地址共用一次请求。实际检查和心跳调度还需计入上次请求耗时。上报使用 HTTP/1.1，不自动跟随 HTTP 重定向；公网入口若强制 HTTPS，应直接配置最终的 HTTPS URL。

自动收集已启用的普通网卡 IPv4，包括 Wi-Fi、以太网；忽略回环、链路本地和未启用网卡的地址，去掉重复地址。有普通网卡时不列出识别出的虚拟网卡；只有虚拟网卡时保留其地址作为备用。若配置了 `server.address` 只监听一个具体 IP，则只上报这个监听地址。请核对 `Discovery addresses reported` 日志。

地址列表增加、减少或某个 IP 改变时都会提前上报；列表排序变化不会额外发送心跳，多个地址合并在同一个请求中发送。需要手动覆盖为一个地址时使用：

```sh
--discovery.address=http://10.13.4.75:8081/
```

也可以填写 VPN 地址、公网 IP 或域名。手动地址按原值上报，不会随本地 IP 自动改变。URL 留空或间隔设为负数时，不检查网卡，也不发启动上报。间隔为 `0` 会导致配置绑定失败，启动日志提示正确设置方式。

## 手机使用与状态

1. 手机打开固定的 Python 服务入口。
2. 查看上报地址、最后上报时间（UTC）和状态。
3. 选择当前网络能访问的 IP，点击对应的“打开文件服务”按钮；浏览器直接导航到 JAR 地址，不从公网网页探测内网、不跨域加载本地内容。

超过 `max(900 秒, 上报间隔 × 3)` 未收到上报，显示“可能离线”，仍保留手动访问按钮。默认间隔 300 秒时，15 分钟过期。页面没有后台轮询，点击“刷新状态”获取最新内容；“最近有上报”表示心跳新鲜，不保证当前手机网络能访问该地址。

跨网段只要 IP 能互通就可以使用。如果手机网络无法访问 JAR 地址，登记地址不会自动打通网络。HTTPS 入口到 HTTP 内网地址使用顶层链接导航；具体浏览器仍可能有 HTTPS 优先或本地网络访问提示，按浏览器提示处理。

## HTTP 协议

`POST /api/heartbeat`，请求头 `Content-Type: application/json`：

```json
{
  "addresses": ["http://10.13.4.75:8081/", "http://192.168.1.20:8081/"],
  "address": "http://10.13.4.75:8081/",
  "reportIntervalSeconds": 300
}
```

- 成功：HTTP `204`，无响应体。
- 参数错误：HTTP `422`，不替换原记录。地址只允许 HTTP(S)，不允许内嵌账号密码；列表为 1～64 个地址，每个最多 2048 字符，自动去重。任一地址无效时拒绝整个请求。间隔为正整数，最大 `2147483647`，省略时为 300。
- 写盘失败：HTTP `503`，不替换内存中的原记录。
- `lastSeen` 使用服务器收到上报时的 UTC 时间，忽略客户端传入的时间。

`GET /` 返回 HTML，带 `Cache-Control: no-store`。公网服务只存一个 JAR 服务的地址列表，新上报完整替换旧列表，断开网卡的旧地址会被移除。`addresses` 为新格式；同时支持旧版单个 `address`。两个字段同时提供时，以列表为准；JAR 保留首个 `address` 字段以兼容旧 Python 服务。

`devices.json` 示例：

```json
{
  "address": "http://10.13.4.75:8081/",
  "addresses": ["http://10.13.4.75:8081/", "http://192.168.1.20:8081/"],
  "lastSeen": "2026-11-03T08:00:00+00:00",
  "reportIntervalSeconds": 300
}
```

## 长期运行

从单地址版本升级时，替换并重启 JAR 和公网 `server.py`，依赖版本未变时无需重装依赖，也无需删除已有 `devices.json`。旧数据文件会自动按单地址读取；仅升级 JAR 而未更新 Python 页面时，旧页面仍只显示第一个地址。要自动列出多个网卡，请将 `discovery.address` 留空。旧部署目录里的说明和测试文件可以移走，运行只依赖前述两个文件及自动生成的数据。

使用一个进程、一个 worker；不要开启 `--reload`，也不要让多个服务实例同时写同一份 JSON。

可通过 systemd 或已有进程管理器配置开机启动和异常重启。systemd 示例（替换用户名、安装路径；与 `nohup` 任选一种，避免重复启动）：

```ini
[Unit]
Description=File Router Discovery
After=network.target

[Service]
Type=simple
User=YOUR_SERVICE_USER
WorkingDirectory=/home/YOUR_SERVICE_USER/discovery-server
ExecStart=/home/YOUR_SERVICE_USER/discovery-server/.venv/bin/python server.py --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

上述监听地址适用于同机反向代理；直接访问端口时改成 `0.0.0.0`。运行用户需要本目录写权限。已有 Nginx HTTPS 站点可将根路径代理到本机服务：

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
}
```

建议使用独立域名根路径。若挂在 `/discovery/` 子路径，代理需要移除该前缀，JAR 对应配置 `https://你的域名/discovery`。仅代理请求，不要将 Python 源码和 `devices.json` 目录配置成公开静态目录。

也可使用 `uvicorn server:app --host 127.0.0.1 --port 8000 --workers 1`，此方式通过环境变量 `DISCOVERY_DATA_FILE` 指定数据文件，默认仍在脚本目录。

## 测试

测试保存在 `src/test/python`，不包含在部署目录中。在仓库根目录执行：

```sh
python -m pip install -r src/test/python/requirements.txt
python -B -m unittest discover -s src/test/python -p test_discovery_server.py -v
```

覆盖多地址展示、去重与移除、旧协议及旧文件兼容、重启恢复、服务器时间、非法输入、状态超时、页面转义、并发写入及写盘失败保留原记录。

本次实现已通过 28 项 Java 测试、12 项 Python 测试，以及本机 Java 上报代码到实际 Uvicorn 服务、JSON 文件和网页链接的联调。公网连通性需在实际部署网络验证。
