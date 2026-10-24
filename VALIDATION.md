# 验证记录

验证项目改用 [psf/requests](https://github.com/psf/requests)，没有使用 README 中的设计参考仓库。

- 项目提交：`611c6162cbc4ac2020a2f91c7cfa4f3abf9bbb60`
- 本地规则扫描：60 个识别到的代码/配置文件，32 条问题，总分 94；其中架构 58、风格 18、可读性 18。
- `npm test`：6 项通过，涵盖多语言识别、无上限累加、项目模式、测试文件特殊处理、缩进/换行及 AI 响应校验。
- `npm run package`：成功生成 `artifacts/shit-code-detector-0.1.0.vsix`。
- `npm audit --omit=dev`：0 个已知漏洞。

上述 Requests 结果由本地评分核心直接读取克隆后的文件得到，未调用 AI，也未运行 VS Code 图形界面；VSIX 的打包与入口文件已验证。仓库版本、设置和 AI 模型变化会使结果变化。
