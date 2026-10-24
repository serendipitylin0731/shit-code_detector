# Shit Code Detector

作者：**_serendipity**

Shit Code Detector 是一个 VS Code 插件，用可解释的扣分项给代码库打“shit 分”：问题越多、影响越大，分数越高，**没有上限**。支持整个工作区、手动选择的文件，以及 HTTPS Git 仓库。默认在本地运行确定性规则；启用 AI 后，可用 DeepSeek 等兼容 Chat Completions 的 API 补充语义和架构审查。

项目以 [chinese-railway-gtfs](https://github.com/wensimehrp/chinese-railway-gtfs) 作为检验场景之一：该仓库有多个 Python 脚本，适合检验多文件结构、长文件和风格一致性。本插件不会将参考项目的结论写死，也不会复制其代码。

## 功能

- **评分当前工作区**：扫描工作区内有效代码；多根工作区保留根目录名称。
- **选择文件评分**：从文件对话框选择一个或多个代码文件，只评估文件本身。
- **评分 HTTPS Git 仓库**：浅克隆到临时目录，扫描后删除临时目录；不执行仓库代码。
- **可选 AI 审查**：通过 VS Code SecretStorage 保存 Key，发送受配置限制的代码片段给 API；报告会注明 AI 覆盖数、截断数和失败批次。
- **逐项可追溯**：报告列出类别、规则来源、文件位置、说明和每项加分。

识别 Python、JavaScript、TypeScript、Go、Rust、Java、Kotlin、C/C++、C#、PHP、Ruby、Swift、Scala、Dart、Shell、SQL、HTML/CSS、Vue、Svelte、JSON、YAML、Terraform 等常用语言与配置代码。完整扩展名表见 `src/analysis.ts`。二进制、生成文件、依赖目录和超出大小限制的文件会跳过，并在报告中计数。

## 安装与运行

需要 Node.js 20+、Git、VS Code 1.85+。

```bash
npm install
npm run compile
```

在 VS Code 中打开本目录，按 **F5** 启动扩展开发宿主。在命令面板运行以下任一命令：

1. `Shit Code Detector: 评分当前工作区`
2. `Shit Code Detector: 选择文件评分`
3. `Shit Code Detector: 评分 HTTPS Git 仓库`

发布安装包可运行 `npm run package`，安装包会放在 `artifacts/` 目录，再用 VS Code 的“从 VSIX 安装”。

## AI 设置

1. 运行 `Shit Code Detector: 设置 AI API Key`，输入 Key。Key 存在 VS Code SecretStorage，不写入项目配置。
2. 在设置中开启 `shitCodeDetector.ai.enabled`。
3. 默认 API 根地址是 `https://api.deepseek.com`，默认模型是 `deepseek-v4-flash`；可修改 `shitCodeDetector.ai.baseUrl` 和 `shitCodeDetector.ai.model` 以接入兼容接口。

启用后，代码片段会发送到配置的 HTTPS API。默认最多抽取 30 个文件，每个文件最多 12,000 字符；本地规则仍扫描所有可读取的有效代码。AI 未配置或请求失败时，报告保留本地分数并说明原因。不同模型和抽样范围可能得到不同的 AI 分数。

## 评分与限制

详见 [SCORING.md](SCORING.md) 和 [DESIGN.md](DESIGN.md)。总分是全部问题分数之和，不做归一化，也不设置满分。因此大项目可能天然获得更高总分；比较不同规模项目时，应同时看每个问题和文件覆盖数。规则为启发式分析，不替代语言专用 linter 或人工代码审查。

```bash
npm test
```

## 版本维护

项目远端为 [serendipitylin0731/shit-code_detector](https://github.com/serendipitylin0731/shit-code_detector)。

