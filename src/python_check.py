"""Parse untrusted Python source without importing or executing it."""

import ast
import io
import json
import re
import sys
import tokenize


def inspect_file(item):
    source = item["content"]
    path = item["path"]
    findings = []
    lines = source.splitlines()
    is_test = bool(re.search(r"(^|/)(test|tests|__tests__|spec|specs)/|(^|/)(test_|spec_)", path, re.I))

    def add(line, category, rule, points, message):
        findings.append({"path": path, "line": line, "category": category,
                         "rule": rule, "points": points, "message": message,
                         "source": "rules"})

    try:
        tree = ast.parse(source, filename=path, type_comments=True)
    except SyntaxError as error:
        add(error.lineno or 1, "correctness", "syntax-error", 5,
            "Python 语法错误：" + str(error.msg))
        return findings
    except (ValueError, TypeError, MemoryError, RecursionError):
        return findings

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            length = (node.end_lineno or node.lineno) - node.lineno + 1
            if length > 180 and function_complexity(node)[0] > 10:
                add(node.lineno, "readability", "long-function",
                    ((length - 121) // 60 + 1) * 2,
                    f"函数长 {length} 行，建议按职责拆分")
            complexity, nesting = function_complexity(node)
            if complexity > 10:
                add(node.lineno, "complexity", "cyclomatic-complexity",
                    ((complexity - 11) // 3 + 1) * 2,
                    f"函数“{node.name}”圈复杂度 {complexity}，超过阈值 10")
            if nesting > 4:
                add(node.lineno, "complexity", "control-nesting", (nesting - 4) * 2,
                    f"函数“{node.name}”控制流嵌套 {nesting} 层，超过阈值 4")
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.If,
                             ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith,
                             ast.Try, ast.ExceptHandler)):
            for body in (getattr(node, "body", []), getattr(node, "orelse", []), getattr(node, "finalbody", [])):
                for previous, current in zip(body, body[1:]):
                    if isinstance(previous, (ast.Return, ast.Raise, ast.Break, ast.Continue)):
                        add(current.lineno, "correctness", "unreachable-code", 4,
                            "前一条语句已终止当前控制流，后续代码不可达")
                        break
        if isinstance(node, ast.ExceptHandler):
            broad = node.type is None or (isinstance(node.type, ast.Name) and
                    node.type.id in {"Exception", "BaseException"})
            if len(node.body) == 1 and isinstance(node.body[0], (ast.Pass, ast.Expr)):
                statement = node.body[0]
                silent = isinstance(statement, ast.Pass) or (isinstance(statement, ast.Expr) and
                         isinstance(statement.value, ast.Constant) and statement.value.value is Ellipsis)
                if silent and broad and not is_test:
                    add(node.lineno, "correctness", "swallowed-error", 5,
                        "宽泛 except 块直接跳过异常，失败时没有可观察结果")
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
            right = node.right
            if isinstance(right, ast.Constant) and isinstance(right.value, (int, float, complex)) and right.value == 0:
                add(node.lineno, "correctness", "zero-division", 5,
                    "除数是字面量 0，执行时会抛出 ZeroDivisionError")
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Constant) and node.value.value is None:
            add(node.lineno, "correctness", "none-dereference", 5,
                "直接访问 None 的属性会抛出 AttributeError")
        if isinstance(node, ast.Subscript) and isinstance(node.value, (ast.List, ast.Tuple)) and not node.value.elts:
            if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, int):
                add(node.lineno, "correctness", "empty-index", 5,
                    "对空列表或元组按整数下标取值会抛出 IndexError")

    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError):
        return findings
    previous = None
    depth = 0
    operators = {"=", "+=", "-=", "==", "!=", "<", ">", "<=", ">=", "+", "-"}
    unary_context = {"(", "[", "{", ",", ":", "=", "return", "yield", "if", "else"}
    for token in tokens:
        if token.type == tokenize.COMMENT:
            comment = token.string
            if not (token.start[0] == 1 and comment.startswith("#!")) and len(comment) > 1:
                if comment[1] not in " #!:" and not comment.startswith(("#noqa", "#type:", "#pylint:", "#fmt:", "#ruff:", "#pyright:")):
                    add(token.start[0], "style", "comment-spacing", 1,
                        "# 注释标记后应留一个空格")
        elif token.type == tokenize.OP:
            operator = token.string
            if operator in operators and token.start[0] == token.end[0] and token.start[0] <= len(lines):
                skip_assignment = operator == "=" and depth > 0
                skip_unary = operator in {"+", "-"} and (previous is None or previous in unary_context)
                line = lines[token.start[0] - 1]
                before = line[token.start[1] - 1] if token.start[1] else " "
                after = line[token.end[1]] if token.end[1] < len(line) else " "
                if not skip_assignment and not skip_unary and (not before.isspace() or not after.isspace()):
                    add(token.start[0], "style", "operator-spacing", 1,
                        f"运算符“{operator}”两侧应留空格")
            if operator in "([{":
                depth += 1
            elif operator in ")]}":
                depth = max(0, depth - 1)
        if token.type not in (tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENCODING):
            previous = token.string
    return findings


def function_complexity(function):
    """Count control-flow decisions without attributing nested functions to their parent."""
    complexity = 1
    maximum_nesting = 0
    decisions = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.IfExp)
    nesting_kinds = decisions + (ast.Try, ast.With, ast.AsyncWith) + tuple(
        kind for kind in (getattr(ast, "TryStar", None), getattr(ast, "Match", None))
        if kind is not None)

    def visit(node, depth):
        nonlocal complexity, maximum_nesting
        if node is not function and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef,
                                                      ast.Lambda, ast.ClassDef)):
            return
        if isinstance(node, decisions):
            complexity += 1
        if isinstance(node, getattr(ast, "Match", ())):
            complexity += len(node.cases)
        if isinstance(node, ast.BoolOp):
            complexity += max(0, len(node.values) - 1)
        if isinstance(node, ast.comprehension):
            complexity += 1 + len(node.ifs)
        next_depth = depth + int(isinstance(node, nesting_kinds))
        maximum_nesting = max(maximum_nesting, next_depth)
        for child in ast.iter_child_nodes(node):
            visit(child, next_depth)

    for statement in function.body:
        visit(statement, 0)
    return complexity, maximum_nesting


def main():
    items = json.load(sys.stdin)
    result = []
    for item in items:
        result.extend(inspect_file(item))
    json.dump({"checked": len(items), "findings": result}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
