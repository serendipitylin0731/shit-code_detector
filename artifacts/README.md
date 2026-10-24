# VSIX 安装包

运行 `npm run package` 后，版本化命名的 `.vsix` 文件保存在此目录。二进制安装包不提交到 Git；源代码和版本记录由 Git 维护。

运行 `npm run fixtures` 可生成好、中、差三个实体项目和 `quality-fixtures.code-workspace`，用于在 VS Code 侧边栏逐个选择工作区并验证评分。生成内容同样不提交到 Git。
