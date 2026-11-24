# LanDrop · 局域网闪传

局域网内的私有媒体中转站：传原文件不压缩、每次上传留版本、全设备可见。

产品规划见 [docs/产品规划书.md](docs/产品规划书.md)。

## 当前状态（M1 第一版）

已完成并本地验证：

- ✅ Express 后端 + tus 断点续传上传
- ✅ SHA-256 内容寻址存储（CAS，相同内容只存一份）
- ✅ SQLite 元数据（同名文件按设备归档、CAS 去重）
- ✅ 图片缩略图（含 HEIC、EXIF 自动转正）、视频首帧、MIME 嗅探
- ✅ 媒体库（按图片/视频/文字/文件分类）、原图预览、Range 下载
- ✅ socket.io 实时通知新文件
- ✅ 固定地址 + mDNS 广播 + 二维码配对
- ✅ React 前端同源托管，移动端适配
- ✅ 文字粘贴发送

## 环境要求

- Node.js 22.5+（本项目用 22.22；`node:sqlite` 需要此版本以上）
- pnpm（前端依赖与本地 SDK link 用；后端仍用 npm）
- ffmpeg（视频封面用，可选；缺失不影响主流程）

## 启动

项目统一通过 Makefile 操作，先看一下有哪些命令：

```bash
make help
```

首次安装并构建，之后日常只需启动服务：

```bash
make install   # web 用 pnpm、server 用 npm
make build     # 构建前端，产物由后端自动托管
make start     # 后台启动/重启开发服务（6861/6862）
make serve     # 构建并前台启动生产服务；make serve-bg 后台启动
```

开发时前后端要一起跑：`make start`（后台常驻，重复执行会先停止再重启）；前台开发用 `make dev`。默认后端 `6861`、前端 `6862`；端口、数据目录、上传上限可覆盖，例如：

```bash
make start PORT=6861 WEB_PORT=6862 DATA_DIR=/tmp/landrop MAX_FILE=5368709125
```

`MAX_FILE` 必须是字节数；清理用 `make clean` / `make clean-all`，两者都不会碰数据目录。

## 扫码访问

- 页面顶部「扫码访问」按钮可打开二维码；旁边的复制按钮一键复制访问地址，弹窗内也能复制。
- 服务端 `/api/access/qrcode` 直接返回二维码 PNG，长期有效。旧的 `/api/pair/qrcode` 是一次性配对令牌，5 分钟过期，两者用途不同。


## 文件预览与回收站


删除是软删除：卡片垃圾桶按钮会先移到「回收站」标签，点「恢复」可还原，CAS 原文件暂不清理。

启动后终端会打印局域网地址，例如：

```
LanDrop 已启动
局域网地址：http://192.168.31.28:3000
配对二维码：http://192.168.31.28:3000/api/pair/qrcode
```

## 手机 / 平板连接

1. 确保设备和服务器在同一个 Wi-Fi，路由器没有开启「AP 隔离 / 客户端隔离」。
2. 在电脑浏览器打开 `http://<服务器IP>:3000/api/pair/qrcode`，显示配对二维码。
3. 用 iPhone / iPad 自带相机扫码，在提示中打开 Safari。
4. 进入后点「添加到主屏幕」，下次一点即开。

> 说明：局域网 IP 走的是 HTTP，不是安全上下文，所以 iPhone 上无法注册 Service Worker（不是完整 PWA），网页内也调不起摄像头——这正是我们用「系统相机扫码」而不是「网页扫码」的原因。详见规划书第四节。

## 使用

- **发送**：在「发送文件」区选择「所有设备」或某台设备，拖拽/选择文件即开始上传。文字可直接粘贴发送。
- **接收**：其他设备会实时收到提示，媒体库里立即可见。
- **改名**：点右上角设备名可以改，方便在多设备里认出彼此。

## 数据存储

数据默认在 `LanDrop/data/`：

```
data/
  media.db       # SQLite 元数据（资产、版本、blob、设备、传输）
  uploads/       # tus 临时上传区
  blobs/sha256/  # 原文件，按哈希分目录，不可变
  thumbs/        # 缩略图
```

可用环境变量覆盖：

- `LANDROP_PORT`：端口，默认 6861，必须是正整数
- `LANDROP_DATA_DIR`：数据目录，相对路径按项目根目录解析
- `LANDROP_MAX_FILE`：单文件上限，字节数，默认 10737418240（10GB）；非法值会导致启动失败

## 开机自启（可选）

```bash
npm install -g pm2
cd server
pm2 start "node --no-warnings src/index.js" --name landrop
pm2 save && pm2 startup
```

## 已验证 / 未验证

已在本机用 curl 完整走通：图片上传、文字上传、同名二次上传产生 v2、类型分类、CAS 去重、缩略图生成、原文件字节一致。

未验证：真实 iPhone/iPad 扫码与 Safari 上传（需要你的设备连入同一局域网实测）；这一步在规划书里标记为 M1 联调项。

## 下一步（M2 / M3）

见规划书第十一节。M2 做搜索、设备别名、传输记录、口令保护；M3 做容器化、HTTPS/PWA、版本淘汰与回收。
