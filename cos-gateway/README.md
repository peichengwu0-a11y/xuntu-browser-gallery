# 接入私有 COS 素材库

网关用腾讯云官方 SDK 列出存储桶内的图片，从 COS 读取缩略图或按需从原图生成 480 像素 WebP。浏览和搜图使用缩略图，下载原图时签发 90 秒有效的 COS 下载地址。目录缓存 60 秒。浏览器首次以图搜图时建立缩略图索引，同一个页面内后续搜索复用已建立的索引。

## 运行

在本目录使用 Node.js 22 或更高版本运行 `npm install`，然后用 `npm start` 启动。部署环境应提供 HTTPS，服务默认只监听本机 `127.0.0.1:8793`。使用容器或云平台端口代理时，将 `XUNTU_BIND` 设为 `0.0.0.0`，端口从平台提供的 `PORT` 读取。

| 服务端环境变量 | 设置 |
| --- | --- |
| `COS_SECRET_ID`、`COS_SECRET_KEY` | 配置到服务端密钥环境。授权仅需桶的 `cos:GetBucket` 和图库对象的 `cos:GetObject` |
| `COS_SESSION_TOKEN` | 使用临时凭据时一起配置 |
| `XUNTU_ACCESS_CODE` | 团队访问码，使用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` 生成 |
| `XUNTU_COS_BUCKET`、`XUNTU_COS_REGION` | 默认是 `lorealmu-1540091546` 和 `ap-guangzhou`。修改时同步更新网站的 `cos-config.json` |
| `XUNTU_COS_PREFIX` | 可选。为空时读取全桶。测试时可限制到单个目录，例如 `产品/主品/` |
| `XUNTU_COS_THUMBNAIL_PREFIX` | 可选。设置后优先读取桶内已有的 WebP 缩略图。其完整对象键为该前缀、原图对象键和 `.webp` 后缀，例如 `thumbs/products/a.png.webp` |
| `XUNTU_ORIGINS` | 允许访问的网页来源，用逗号隔开。默认允许当前 GitHub Pages 域名和 `http://127.0.0.1:8792` |

本地网页从主项目运行 `node serve.cjs`。发布到 GitHub Pages 时，将网关的 HTTPS 基础地址设为仓库 Actions 变量 `XUNTU_COS_API`，重新执行 Pages 工作流。入口在网页的「全部素材」标题下方，用团队访问码连接。网关只提供读操作。访问码保存在当前页面内存中。

## 请求记录

连接后点击「COS 素材库」→「查看请求记录」。数字从当前服务进程启动时开始计算，分别记录目录读取尝试、缩略图来源读取尝试和原图链接签发。每次 COS 下载及费用以腾讯云监控和账单为准。原图链接的签发次数可能与实际下载次数不同。预览缓存按源文件版本区分，最大 64 MB。超过 32 MB 或 3500 万像素的源图需要预先提供缩略图，仍可通过详情下载原图。
