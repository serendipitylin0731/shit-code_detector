# 参考项目与取舍

主要参考：[Done-0/fuck-u-code](https://github.com/Done-0/fuck-u-code) 的 [README](https://github.com/Done-0/fuck-u-code/blob/27ae48f50816a40afc4c6f4923e9444883683093/README.md)、[指标目录](https://github.com/Done-0/fuck-u-code/tree/27ae48f50816a40afc4c6f4923e9444883683093/src/metrics) 与 [解析器目录](https://github.com/Done-0/fuck-u-code/tree/27ae48f50816a40afc4c6f4923e9444883683093/src/parser)。参考提交为 `27ae48f50816a40afc4c6f4923e9444883683093`。本项目保留 VS Code 左侧操作界面、三种评分入口和无上限总分；代码独立实现。

| 参考项目质量维度 | 本插件的实现 |
| --- | --- |
| Complexity | JS/TS 与 Python AST 计算函数圈复杂度和控制流嵌套；逐函数、逐项加分。 |
| Size | 函数长度、参数数量、非测试文件长度、目录文件数。 |
| Comments | 注释标记空格与文件内风格一致性；语义质量交给可选 AI。 |
| Error handling | 空或只记录日志的 JS/TS `catch`；Python 宽泛异常处理。 |
| Naming | 明显模糊名称的本地规则，复杂语义由可选 AI 判断。 |
| Duplication | 足够长的完全相同连续代码块，跨所选文件或项目文件比较。 |
| Structure | 项目模式检查相对导入环、超大文件与拥挤目录；可选 AI 评估模块职责和设计逻辑。 |

参考项目的总体质量分为 0–100，分高代表质量更好。本插件按用户要求采用 `总分 = 所有有效问题的正向加分之和`，分高代表问题更多，**不封顶**。解析深度也有明确区别：参考项目为多语言 Tree-sitter，本插件当前对 JS/TS 和 Python 做 AST 深度检查；其他受支持语言先运行通用规则，再由可选 AI 补充语义分析。报告显示解析覆盖范围，避免把“支持读取”误解为“所有语言都具有相同深度”。

未直接采用注释占比、所有异常相关调用都算缺少错误处理、或只凭控制流形状判断重复代码：这些规则会把清晰短函数、可选依赖探测和不同语义的函数误判。真实项目回归中，Python `TYPE_CHECKING` 导入与 `__init__.py` 模块转发也从循环依赖的确定性判定中排除。
