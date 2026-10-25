# Shit Code Detector

<img src="media/logo.png" alt="Shit Code Detector 标志" width="88" height="88">

作者：**_serendipity**

Shit Code Detector 是一个 VS Code 插件。它先累计内部问题分，再通过[五段转换函数](SCORING.md)输出 **0–9 分**的“shit 分”：越接近 9，代码问题越严重。支持当前项目、编辑器中正在打开的单个文件，以及 HTTPS Git 仓库。默认在本地运行确定性规则；保存 AI Key 后，可用 DeepSeek 等兼容 Chat Completions 的 API 按固定 A–E 评分表补充语义和架构审查。质量维度参考 [Done-0/fuck-u-code](https://github.com/Done-0/fuck-u-code)，具体取舍见 [REFERENCE.md](REFERENCE.md)。

评分回归使用仓库内可重复的好、中、差三档样本；真实项目补充验证使用 [psf/requests](https://github.com/psf/requests)。测试数据和结果见 [VALIDATION.md](VALIDATION.md)。

## 功能

- **右侧辅助边栏界面**：顶部显示 0–9 最终分，提供当前项目、单文件、Git 仓库三目标切换；显示问题最多的文件和各类问题数量。每条问题只显示严重程度、类别、位置和理由，不显示单条加分。支持按文件与类别筛选、翻页和跳转。齿轮按钮收起 AI 设置。
- **评分当前项目**：从当前项目根目录读取代码；多根工作区使用第一个根目录，参与文件由该目录的规则文件决定。
- **评分当前文件**：直接分析编辑器里当前停留的单个代码文件，包括未保存修改；无需文件选择对话框。
- **评分 HTTPS Git 仓库**：切换到 Git 仓库页后输入地址，可导入一份本地 `.shitcode` 或 `.shitcode_ignore` 筛选仓库文件；浅克隆到临时目录，扫描后删除，不执行仓库代码。
- **本地静态分析**：检查运算符空格、注释格式、圈复杂度、认知复杂度、控制流嵌套、不可达代码、重复代码、循环依赖、异常处理、C/C++ 宏风险，以及 Python/JS/TS 的可确定语法与运行异常。格式分设聚合上限；文件长度、目录文件数和 `tmp` 等名称不单独判定代码质量。
- **大项目可响应**：本地解析与评分在工作线程运行，可取消，不阻塞 VS Code 扩展主线程。
- **根目录评分配置**：当前项目和单文件使用 `.shitcode` 允许列表或 `.shitcode_ignore` 排除列表；两者同时存在时只读取 `.shitcode`。路径写法、通配符、注释和 `!` 否定规则与 `.gitignore` 一致。`.gitignore` 本身不再决定文件是否参与评分。
- **可选 AI 审查**：预先固定 11 个文件条目和 6 个项目条目，覆盖逻辑、边界、资源、性能、架构与安全。每项给 A–E、N/A 或 U；A 为零分，B–E 按基础分乘固定权重，U 表示未完成。Key 保存在 VS Code SecretStorage，保存后每次评分自动调用 AI；报告列出每项等级、证据与覆盖数。完整标准见 [AI_RUBRIC.md](AI_RUBRIC.md)。
- **逐项可追溯**：Markdown 报告列出分类、文件问题数及所有问题的严重程度；可导出不含完整源文件与 API 配置的 JSON 报告。问题说明可能引用短代码片段。

识别 Python、JavaScript、TypeScript、Go、Rust、Java、Kotlin、C/C++、C#、PHP、Ruby、Swift、Scala、Dart、Shell、SQL、HTML/CSS、Vue、Svelte、JSON、YAML、Terraform 等常用语言与配置代码。完整扩展名表见 `src/analysis.ts`。二进制、生成文件、依赖目录和超出大小限制的文件会跳过，并在报告中计数。

## 安装与运行

需要 Node.js 20+、Git、VS Code 1.106+。如需 Python 语法、运算符与明显异常检查，还需本机 Python 3；没有 Python 时插件仍可运行其他规则，并在报告显示解析覆盖数。

```bash
npm install
npm run compile
```

在 VS Code 中打开本目录，按 **F5** 启动扩展开发宿主。从**右侧辅助边栏**打开 Shit Code Detector，在“当前项目／单文件／Git 仓库”之间切换。右上角齿轮可保存或更换 AI Key。也可以使用命令面板：

1. `Shit Code Detector: 评分当前项目`
2. `Shit Code Detector: 评分当前文件`
3. `Shit Code Detector: 评分 HTTPS Git 仓库`
4. `Shit Code Detector: 导出 JSON 报告`

安装包在 [GitHub Releases](https://github.com/serendipitylin0731/shit-code_detector/releases) 发布；下载对应版本的 `.vsix`，再用 VS Code 的“从 VSIX 安装”。`npm run package` 仅供本地构建验证，产物放在被 Git 忽略的 `artifacts/` 目录。推送 `v` 开头且与 `package.json` 版本一致的标签后，GitHub Actions 会测试、打包并创建 Release。

## 选择参与评分的文件

在**当前项目根目录**放置以下文件之一；多根工作区默认评分第一个根目录。单文件模式读取当前打开的代码文件，并应用它所属根目录的配置。两个配置文件同时存在时，`.shitcode` 优先，即使它是空文件也不会回退到 `.shitcode_ignore`。

- `.shitcode`：允许列表，只有命中的有效代码文件参与评分。
- `.shitcode_ignore`：排除列表，所有有效代码文件中只有命中的文件不参与评分。本仓库根目录已提供 [`.shitcode_ignore`](.shitcode_ignore)，可直接编辑。

例如，`.shitcode` 可以写成：

```gitignore
src/**/*.py
src/**/*.ts
!src/generated/**
```

`.shitcode_ignore` 可以写成：

```gitignore
node_modules/
dist/
*.generated.*
!src/keep.generated.ts
```

每行的相对路径以对应根目录为基准；空行、`#` 注释、`*`／`**` 通配符、目录末尾的 `/` 和 `!` 否定规则均沿用 `.gitignore` 语法。没有这两个文件时，根目录沿用内置的有效代码过滤。被配置选中的文件仍需是支持的代码类型、不是二进制且不超过读取大小限制；旧版 `ai.local.json` 始终排除。Git 仓库页可从本机导入**一份**同名规则文件，规则相对于克隆仓库根目录生效；未导入时使用内置有效代码过滤。导入仅在本次扩展会话中保留，可在界面清除。**`.gitignore` 只用于 Git 版本管理，不影响任何评分模式的文件选择。**

## AI 设置

点击右侧边栏右上角的**齿轮**，再点“保存或更换 API Key”输入 DeepSeek API Key。插件只将它存入 VS Code SecretStorage；不会在工作区创建配置 JSON。保存后下一次评分自动调用 AI，无需再开启开关。留空并确认可删除已保存的 Key。齿轮中还可打开 VS Code 设置，调整 `shitCodeDetector.ai.baseUrl` 与 `shitCodeDetector.ai.model`。

开发者可用环境变量 `DEEPSEEK_API_KEY` 运行 `npm run test:ai`，也可继续使用本仓库已有的、被 Git 忽略的 `ai.local.json` 作为测试脚本的 Key 来源；环境变量优先，可选设置 `DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL`。该文件只供开发测试脚本读取，插件不会读取或创建它。这是显式调用真实 API 的测试，会产生 API 请求；普通 `npm test` 不调用网络 AI。

评分时，代码片段会发送到配置的 HTTPS API。默认模型为 `deepseek-flash`，这是 [DeepSeek 当前推荐的 Flash API 名称](https://api-docs.deepseek.com/updates/)；使用其他兼容服务时可在设置中改模型与地址。旧版 `ai.local.json` 不再用于插件配置，也不会作为代码扫描。没有保存 Key 或请求失败时，报告保留本地分数并说明原因。

AI 对收集到的所有有效代码逐片送审。请求分片大小仅控制单次请求，不限制项目总量：

| 设置 | 默认值 | 作用 |
| --- | ---: | --- |
| `ai.maxCharsPerRequest` | 12,000 字符 | 单次文件请求的代码字符数；长文件连续分片并保留原始行号 |
| `maxFileBytes` | 0（不限） | 可选的单文件读取上限；设为正数才会跳过超限文件并计数 |

文件级 AI 请求最多同时进行两次；项目级审查将全部文件的路径、语言、行数、导入和本地架构发现分批送审。报告显示完整分级文件数、有效审查字符数和失败项。大项目会产生较多 API 请求、耗时与费用；请求失败或用户取消后不会把未审查代码记成 A。不同模型可能得到不同的 AI 分数。

从 v0.8.0 起，旧的 `ai.maxFiles`、`ai.maxCharsPerFile` 和 `ai.maxTotalChars` 设置不再生效；如需调整单次请求大小，请使用 `ai.maxCharsPerRequest`。

## 评分与限制

详见 [SCORING.md](SCORING.md)、[AI_RUBRIC.md](AI_RUBRIC.md) 和 [DESIGN.md](DESIGN.md)。内部原始分按类别聚合；本地维护性提示按规模平滑，确定的正确性与安全问题及 AI 条目保持原权重；最终分经公式映射到 0–9。侧边栏另列高风险状态、问题密度、各类问题数及 Git 增量。比较不同规模项目时，应同时看这些指标与扫描覆盖数。规则为启发式分析，不替代语言专用 linter 或人工代码审查。

```bash
npm test
npm run fixtures
```

`npm run fixtures` 会在 `artifacts/quality-fixtures/` 中生成 good、medium、bad 三档实体项目。分别将这三个目录作为 VS Code 根目录打开，即可人工验证评分梯度。

## 版本维护

项目远端为 [serendipitylin0731/shit-code_detector](https://github.com/serendipitylin0731/shit-code_detector)。

