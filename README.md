# Shit Code Detector

作者：**_serendipity**

Shit Code Detector 是一个 VS Code 插件，用可解释的扣分项给代码库打“shit 分”：问题越多、影响越大，分数越高，**没有上限**。支持整个工作区、手动选择的文件，以及 HTTPS Git 仓库。默认在本地运行确定性规则；启用 AI 后，可用 DeepSeek 等兼容 Chat Completions 的 API 补充语义和架构审查。

评分回归使用仓库内可重复的好、中、差三档样本；真实项目补充验证使用 [psf/requests](https://github.com/psf/requests)。测试数据和结果见 [VALIDATION.md](VALIDATION.md)。

## 功能

- **左侧活动栏界面**：顶部显示无上限总分，下方列出每条加分、类别、严重程度、文件位置和理由；颜色区分严重程度，支持筛选、翻页和跳转到文件。
- **评分工作区**：可选择一个工作区或全部工作区；多根工作区保留根目录名称。
- **选择文件评分**：从文件对话框选择一个或多个代码文件，只评估文件本身。
- **评分 HTTPS Git 仓库**：浅克隆到临时目录，扫描后删除临时目录；不执行仓库代码。
- **可选 AI 审查**：在本地 `ai.local.json` 填写 Key，或通过 VS Code SecretStorage 保存；报告会注明 AI 覆盖数、截断数和失败批次。
- **逐项可追溯**：报告列出类别、规则来源、文件位置、说明和每项加分。

识别 Python、JavaScript、TypeScript、Go、Rust、Java、Kotlin、C/C++、C#、PHP、Ruby、Swift、Scala、Dart、Shell、SQL、HTML/CSS、Vue、Svelte、JSON、YAML、Terraform 等常用语言与配置代码。完整扩展名表见 `src/analysis.ts`。二进制、生成文件、依赖目录和超出大小限制的文件会跳过，并在报告中计数。

## 安装与运行

需要 Node.js 20+、Git、VS Code 1.85+。

```bash
npm install
npm run compile
```

在 VS Code 中打开本目录，按 **F5** 启动扩展开发宿主。点击左侧活动栏的 **Shit Code Detector** 图标，在界面中选择工作区、文件或 Git 仓库并评分。也可以使用命令面板：

1. `Shit Code Detector: 评分当前工作区`
2. `Shit Code Detector: 选择文件评分`
3. `Shit Code Detector: 评分 HTTPS Git 仓库`

安装包在 [GitHub Releases](https://github.com/serendipitylin0731/shit-code_detector/releases) 发布；下载对应版本的 `.vsix`，再用 VS Code 的“从 VSIX 安装”。`npm run package` 仅供本地构建验证，产物放在被 Git 忽略的 `artifacts/` 目录。推送 `v` 开头且与 `package.json` 版本一致的标签后，GitHub Actions 会测试、打包并创建 Release。

## AI 设置

当前工作区根目录已放置 **`ai.local.json`**，请把 `apiKey` 的占位符改成你的 DeepSeek Key。该文件已加入 `.gitignore`，不会提交到仓库；[示例模板](ai.local.example.json) 保留在版本库。界面中的“打开本地配置”按钮可直接打开它。

```json
{
  "enabled": true,
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "apiKey": "YOUR_DEEPSEEK_API_KEY_HERE"
}
```

也可以运行 `Shit Code Detector: 设置 AI API Key`，将 Key 存入 VS Code SecretStorage，并在设置中开启 `shitCodeDetector.ai.enabled`。存在本地配置时，它的 `enabled`、`baseUrl`、`model` 和已填写的 `apiKey` 优先；缺失字段沿用 VS Code 设置或 SecretStorage。

填写本地文件后可运行 `npm run test:ai`，让 AI 分别审查好、中、差三个样本并打印分数。这是显式调用真实 API 的测试，会产生 API 请求；普通 `npm test` 不会调用网络 AI。

启用后，代码片段会发送到配置的 HTTPS API。默认最多抽取 30 个文件，每个文件最多 12,000 字符；本地规则仍扫描所有可读取的有效代码。`ai.local.json` 本身始终排除在代码扫描之外。AI 未配置或请求失败时，报告保留本地分数并说明原因。不同模型和抽样范围可能得到不同的 AI 分数。

## 评分与限制

详见 [SCORING.md](SCORING.md) 和 [DESIGN.md](DESIGN.md)。总分是全部问题分数之和，不做归一化，也不设置满分。因此大项目可能天然获得更高总分；比较不同规模项目时，应同时看每个问题和文件覆盖数。规则为启发式分析，不替代语言专用 linter 或人工代码审查。

```bash
npm test
npm run fixtures
```

`npm run fixtures` 会在 `artifacts/` 中生成三档实体项目及 `quality-fixtures.code-workspace`。在 VS Code 打开该工作区文件后，可从插件侧边栏分别选择 good、medium、bad 进行人工验证。

## 版本维护

项目远端为 [serendipitylin0731/shit-code_detector](https://github.com/serendipitylin0731/shit-code_detector)。

