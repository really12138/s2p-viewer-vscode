# S2P Viewer

[English](README.md)

S2P Viewer 是一个只读、离线的 VS Code 扩展，用于快速预览和对比二端口
Touchstone S 参数文件。它适合 RF、微波和器件建模中的日常检查，例如测量与
仿真、原始与去嵌、不同偏置/温度/工艺角数据之间的对比。

## 主要功能

- 点击 `.s2p`/`.S2P` 文件后默认打开工程化预览。
- S11、S22 使用 Smith Chart；S12、S21 使用幅度 dB 图。
- 提供合并对比和 S 矩阵四宫格两种版式；四宫格顺序为左上 S11、右上 S12、
  左下 S21、右下 S22。
- 可通过工具栏文件选择器或 Explorer 多选对比 2–10 个文件。
- 每个文件具有独立颜色、显隐、移除、重试和错误状态。
- 四张图共享最近真实频点指针，不会把不同频率网格按数组下标错误对齐。
- 反射参数读数包含复数值、幅度、相位和阻抗。
- 支持主文件未保存修改和外部对比文件变化的局部刷新。
- Plotly 和解析器均打包在扩展中，不依赖网络或外部运行时。

## 安装

从 GitHub Release 下载 `s2p-viewer-0.1.0.vsix`，然后执行：

```powershell
code --install-extension ".\s2p-viewer-0.1.0.vsix" --force
```

也可以从源码构建（需要 Node.js 22.13+ 和 VS Code 1.123+）：

```powershell
npm ci
npm run package
code --install-extension ".\dist\s2p-viewer-0.1.0.vsix" --force
```

## 使用方法

直接点击或打开 `.s2p` 文件即可进入 **S2P Preview**。如需查看原始文本，可在
命令面板执行 **S2P Viewer: Reopen as Text**，或使用 **Reopen Editor With →
Text Editor**。

- **Combined comparison**：S11/S22 共用 Smith 图，S21/S12 共用 dB 图。
- **Four-grid**：按 S11、S12、S21、S22 的矩阵顺序显示。
- **Add Files**：多选对比文件。
- Explorer 中多选 `.s2p` 后，右键目标主文件并选择 **Compare S2P Files**。
- **Auto**：自动缩放；**Reset**：清除同步指针并重置坐标范围。
- **File**：打开文件面板，控制显隐、移除或重试。

将鼠标悬停在曲线上可吸附到真实频点；单击锁定，再次单击或按 `Escape` 解锁。
当读数区域获得键盘焦点后，可用左右方向键移动主文件频点。

## 支持格式

- Touchstone 1.x、2.0、2.1 二端口 S 参数
- `Hz`、`kHz`、`MHz`、`GHz`
- `RI`、`MA`、`DB`
- Touchstone 2.x full/lower/upper 矩阵及两种二端口数据顺序
- 全局或逐端口参考阻抗
- UTF-8/ASCII、UTF-8 BOM、注释、换行记录和科学计数法

已识别的噪声段会被忽略并在元数据中标记。格式错误会显示结构化诊断；单个对比
文件失败不会影响其他有效文件的绘图。

## 隐私与安全

扩展只读，不会修改 Touchstone 文件；不包含遥测、CDN、网络服务、本地服务器，
也不要求 Python、MATLAB 或其他外部运行时。请勿在公开 Issue 中上传专有测量数据
或 PDK 文件，建议使用最小合成样例复现问题。

## 已知限制

0.1.0 不支持编辑、去嵌、校准、无源性/因果性分析、参数转换、噪声绘图、非二端口
`.sNp`、CSV/图片导出、自动配对、超过十个文件或持久化磁盘缓存。本版本不承诺
浏览器版及 Remote Extension Host 兼容性。

## 开发

```powershell
npm ci
npm run check
npm test
npm run build
npm run test:integration
npm run package
```

真实目录基准命令（只读）：

```powershell
npm run benchmark -- --raw-dir "C:\path\to\raw" --deembedded-dir "C:\path\to\deembedded" --count 10
```

贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见
[SECURITY.md](SECURITY.md)，架构与信任边界见
[docs/architecture.md](docs/architecture.md)。

本项目采用 [MIT License](LICENSE)，Plotly.js 声明见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
