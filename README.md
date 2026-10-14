# 寻图 UI · GitHub Pages 浏览器搜图（独立项目）

独立的新项目。与原来的“寻图”Python 网站使用不同目录、端口及数据存储。运行时不连接原网站 API。共享发布版包含经用户授权导出的 5,304 张缩略图、名称、公盘路径与预先生成的检索索引；导出时原数据库只读，原网站保持独立。

界面已按用户提供的“寻图”截图调整，直接复用原站 CSS；浏览器版的操作适配位于 `pages.css`。顶栏为 BEAUTY ASSET，页面标题为“寻图 · 浏览器版”。项目目录与启动文件仍沿用独立版原来的名称，以便区分工程。

## 本机试用

双击 `打开图迹.vbs`，或安装 Node.js 后运行 `node serve.cjs`，打开 http://127.0.0.1:8792/ 。

请通过 localhost 或 HTTPS 打开。直接双击 HTML 使用 file:// 地址无法可靠加载 Worker 和浏览器存储。

## 功能

- 左侧文件夹导航按现有共享素材的公盘路径展示多层目录与素材数。点击文件夹筛选右侧素材，点击“全部素材”取消目录筛选；搜图默认搜索全部图库。
- 导入拾盘 ZIP 时以压缩包名称（去掉 `.zip`）建立顶层文件夹，按素材清单中的目录保留子分类；同名包合并到同一目录。分类存入当前浏览器，备份导出与恢复保留分类。
- 上传、拖拽或 Ctrl+V 粘贴 JPG、PNG、WebP 截图，以图搜索素材。
- 导入拾盘 ZIP 素材包，包含 `manifest.json` 与 `thumbnails/`。支持每文件夹一张代表图的导出格式，优先使用 `folder_path` / `shared` 作为公盘文件夹路径。
- 添加本地图片，保存最长边 640 像素的 JPEG 预览。浏览器无法取得所选文件的完整磁盘路径，可在详情中自行填写公盘位置。
- 按名称、原文件路径、公盘文件夹路径筛选，分页浏览及查看大图。
- 编辑和保存 CCH 网页链接、公盘路径，复制路径，下载缩略图。
- 点击右上角“后台上传”进入浏览器素材管理，可导入素材包、添加图片、选择当前页或全部筛选结果，确认后批量删除。
- 导出完整备份 ZIP，包含图片与链接，可导入另一台电脑或恢复当前浏览器。
- 图片解码、索引、检索在浏览器 Worker 中执行。依赖文件随项目部署，不使用外部 CDN。

导入 ZIP 最大 200 MB、解压后最大 512 MB、每包最多 10000 张。单张查询或添加图片最大 15 MB、3500 万像素。导入取消时不保存部分记录；无法解码的图片会跳过并计入提示。

所有访客自动加载 `shared-gallery/manifest.json` 指定的同一份共享图库。上传的查询图片只在浏览器内处理。个人添加、链接修改、隐藏素材存放在 IndexedDB（`tuji-browser-pages-v1`），只影响当前浏览器。清理网站数据、隐私模式或浏览器存储回收可能清除图库，请定期导出备份。localhost 和 GitHub Pages 的图库不同，迁移请用备份包。

## 检索方式与边界

当前引擎为 **DISK + LightGlue-ONNX**（官方 v1.0.0 模型）。DISK 每张图片最多保留 2,048 个特征点，LightGlue 匹配后使用 RANSAC 几何验证，至少 40 个几何内点，且内点占匹配数至少 30%，才进入结果。输入保持比例，缩放至最长边 480，再放入 512 × 512 白色画布。素材本身仍是原共享图库缩略图。

上传截图后先运行 ORB 快速检索，立即展示通过快速几何验证的结果。没有找到或结果不满意时，可点击“LightGlue 精细匹配”，才加载神经索引与模型：用 DISK 随机投影指纹检索候选，并合并第一阶段已缓存的 ORB 候选，通常对最多 24 张共享素材运行 LightGlue；本机添加的图片也参与匹配。精细结果按 LightGlue 几何内点数排序。“全库精细匹配”会逐张运行 LightGlue，5,304 张素材可能耗时很长，可以取消。快速和精细结果分别标注匹配方式。

浏览器使用本地部署的 ONNX Runtime Web 1.27.0。特征提取与匹配优先 WebGPU，兼容模式使用 WebAssembly；模型在首次检索时加载，查询图片不会上传到服务器。预览来自缩略图，所以极小文字、严重模糊或很小的局部仍可能无法识别。最多显示 20 个候选，内点数不是概率；相似版本需人工核对。

共享神经索引由 `scripts/build-lightglue-index.py` 预先生成，生成环境需要 Pillow、NumPy 和 ONNX Runtime（可选 DirectML 加速）。完整描述子在本机生成缓存或在访客浏览器中提取，不会把庞大的完整描述子库加载到浏览器。首次检索需要下载约 75 MB 模型及浏览器运行库，另有页面初始化时加载的共享检索索引。

## 部署到 GitHub Pages

1. 在 GitHub 创建一个独立仓库，例如 `tuji-image-finder`。
2. 把此文件夹里的项目文件提交到仓库根目录（包含 `.github/workflows/pages.yml`、`.nojekyll` 和 `vendor/`）。共享图片与索引保存在 `shared-gallery/`，一起发布。
3. 默认分支使用 `main`。仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
4. 推送 `main`，或到 **Actions → Deploy browser image finder → Run workflow** 执行部署。
5. 成功后访问 `https://你的用户名.github.io/仓库名/`，自动加载共享图库。

所有资源使用相对地址，支持 GitHub Pages 仓库子路径。发布产物包含网页、运行依赖与共享图库，不包含启动脚本或测试文件。也可以在 Pages 选择 Deploy from a branch / main / root，作为无构建静态站发布。

GitHub Pages 是静态托管，没有服务器端管理员账号、多人共享数据库或自动公盘扫描。本版以当前浏览器素材管理替代服务器后台；不会用前端密码冒充真正的账号权限。共享图库无需导入；个人修改迁移时可导入备份包。公盘地址需要复制到具有访问权限的资源管理器中使用。CCH 链接由用户填写。

共享图库更新：运行 `scripts/build-shared-gallery.py --help` 查看只读导出参数，再运行 `python scripts/build-lightglue-index.py` 生成新的神经索引，然后提交并推送到 main，GitHub Actions 自动发布。网页里的“后台上传”是个人素材管理，不会更新所有人的图库。

## 检查

`node tests/vision.test.cjs` 验证同图、缩放、裁切及空白图处理，使用随项目保存的 OpenCV.js。

## 第三方组件

- `@techstark/opencv-js` 4.11.0-release.1（OpenCV WebAssembly，Apache-2.0）。
- `fflate` 0.8.2（ZIP 读取与备份，MIT）。

依赖已从 npm 官方注册表下载并核对完整性，许可证见 `vendor/`。不需要 npm install 或 Python 后端。

- LightGlue-ONNX v1.0.0、DISK 与 LightGlue：Apache-2.0；来源和许可证见 `vendor/lightglue/`。
- ONNX Runtime Web 1.27.0：MIT，见 `vendor/onnxruntime/LICENSE.txt`。

浏览器版 DISK 模型对 NMS 索引算子做了等价兼容改写，输入固定为 512 × 512；模型权重不变。生成脚本为 `scripts/prepare-disk-web.py`，可验证修改前后模型输出。
