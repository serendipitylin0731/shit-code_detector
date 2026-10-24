# 验证记录

## 可重复的分级样本

`test/fixtures/quality.ts` 包含三个小型多语言项目，`test/quality.test.ts` 验证评分梯度及关键规则：

| 样本 | 特征 | 本地分数 |
| --- | --- | ---: |
| good | 清晰命名、单一职责函数和对应测试 | 0 |
| medium | 局部模糊命名、尾部空格和超长行 | 4 |
| bad | 大文件、大量重复风格问题、混合缩进与跨文件不一致 | 432 |

这些样本验证规则在已知问题数量和严重程度增加时保持单调；AI 的语义判断另由模拟响应测试验证格式、路径和严重度校验。

运行 `npm run fixtures` 会把三个样本写成可打开的实体项目，并生成 `artifacts/quality-fixtures.code-workspace`。在 VS Code 打开此多根工作区后，可从侧边栏分别选择 good、medium、bad，验证完整操作流程。

2026-10-24 使用本地配置的 DeepSeek API 实测一轮：good 为 0 分（AI +0），medium 为 12 分（AI +8），bad 为 458 分（AI +26），三个文件批次均完成。AI 输出具有波动性，这组数字是一次观察结果，不作为固定断言。

## 真实项目补充验证

使用 [psf/requests](https://github.com/psf/requests) 提交 `611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60`。本地评分核心直接读取克隆文件，识别 60 个代码/配置文件，得到 32 条问题、总分 94，其中架构 58、风格 18、可读性 18。未调用 AI；仓库版本变化会影响结果。

## 构建验证

- `npm test`：覆盖分级样本、规则累加、语言识别、AI 响应、本地配置解析和界面严重程度映射。
- `npm run package`：本地生成 `artifacts/shit-code-detector-0.2.0.vsix`；公开安装包由 GitHub Release 提供。
- `npm audit`：依赖审计。

VS Code 图形界面的手动点击验证仍需在扩展开发宿主中运行；自动测试覆盖其数据映射与命令后端的评分核心。
