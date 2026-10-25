import type { Category } from './analysis';

export type AiGrade = 'A' | 'B' | 'C' | 'D' | 'E';
export type AiScope = 'file' | 'project';

export interface AiCriterion {
  id: string;
  title: string;
  scope: AiScope;
  category: Category;
  weight: number;
  focus: string;
  anchors: Record<AiGrade, string>;
}

export const AI_RUBRIC_VERSION = '5.0';
export const AI_BASE_POINTS: Readonly<Record<AiGrade, number>> = Object.freeze({ A: 0, B: 2, C: 4, D: 6, E: 10 });

/** The only source for AI criteria, weights and grade anchors. */
export const AI_CRITERIA: readonly AiCriterion[] = Object.freeze([
  {
    id: 'semantic_naming', title: '命名语义', scope: 'file', category: 'naming', weight: 1,
    focus: '名称是否帮助理解对象与职责。短作用域的 temp、i 或领域惯用缩写可以合理；不凭单个词或未知业务目标扣分。',
    anchors: { A: '名称清楚或在局部上下文中容易辨认。', B: '少量名称略泛，阅读仍然顺畅。', C: '一个重要名称使读者需要回看上下文。', D: '多个关键名称含糊，显著增加阅读负担。', E: '核心代码的命名系统性混乱，难以理解职责。' }
  },
  {
    id: 'function_cohesion', title: '函数职责内聚', scope: 'file', category: 'architecture', weight: 1,
    focus: '仅当一个函数混合互不相关的职责且影响理解时扣分。多个顺序步骤若共同服务于一个清楚的目的，应视为内聚；不能凭操作种类、分支数或函数长度扣分。生成仓库状态报告所需的收集、格式化与输出可以属于同一职责。',
    anchors: { A: '步骤共同服务于清楚的目的。', B: '一个辅助步骤稍偏离主目的，仍容易理解。', C: '一处可辨认的不相关职责混入函数。', D: '关键函数混合多项互不相关的职责，阅读时必须频繁切换语境。', E: '核心函数成为多个无关领域的汇集点，职责界限无法辨认。' }
  },
  {
    id: 'error_strategy', title: '异常与失败处理风格', scope: 'file', category: 'consistency', weight: 1,
    focus: '只评价异常处理写法是否清晰、同类路径是否一致。直接传播、返回错误、记录或恢复都可以；不判断处理结果是否正确，不要求捕获，不重复本地空 catch/except。',
    anchors: { A: '失败处理写法清楚且一致，或本片段不适用。', B: '一处次要写法略含糊。', C: '一处重要处理写法不清楚或同类路径不一致。', D: '多处处理写法混杂，阅读需要额外辨认。', E: '核心代码的失败处理写法系统性混乱。' }
  },
  {
    id: 'semantic_duplication', title: '不必要的重复', scope: 'file', category: 'duplication', weight: 1,
    focus: '只有重复造成真实的理解或维护负担，且提取后不会牺牲直观性时才扣分。少量重复步骤、为避免额外参数而保留的局部重复、各分支的共同检查都可以合理；不能仅凭存在重复判定。',
    anchors: { A: '重复若存在，保留它比抽象更清楚。', B: '少量重复带来轻微同步负担，提取可能略有帮助。', C: '一组重复逻辑需要同步修改，且可清楚地统一。', D: '多组不必要的重复逻辑造成明显维护负担。', E: '核心规则被大量复制，且存在简单清楚的统一方式。' }
  },
  {
    id: 'control_flow_clarity', title: '控制流清晰度', scope: 'file', category: 'readability', weight: 2,
    focus: '评价深层嵌套、复杂条件或跳转是否真的妨碍追踪。长 if-else 分发若顺序清楚可评 A；不得仅因为没改用映射表、策略模式，或分支较多就扣分。不重复本地圈复杂度与嵌套数字。',
    anchors: { A: '执行路径容易追踪，长分支也可清楚。', B: '一处轻微绕行但不妨碍理解。', C: '一处嵌套或条件组合需要反复追踪。', D: '多个重要路径难以追踪。', E: '核心控制流层层绕行，局部难以判断接下来执行什么。' }
  },
  {
    id: 'expression_simplicity', title: '表达简洁性', scope: 'file', category: 'readability', weight: 2,
    focus: '只判断不必要的中间变量、包装函数、状态或间接层是否增加阅读成本。有助于命名与解释的中间变量应保留；不能为了减少行数而牺牲清晰度。',
    anchors: { A: '表达直接，辅助变量或包装有清楚用途。', B: '一处轻微多余步骤。', C: '一处不必要的中间层明显打断阅读。', D: '多个冗余变量、包装或状态迫使读者追踪。', E: '核心流程主要由无意义间接层组成。' }
  },
  {
    id: 'abstraction_fit', title: '抽象恰当性', scope: 'file', category: 'architecture', weight: 3,
    focus: '重点检查过度封装、无意义的抽象及本可清楚统一却散落的共同逻辑；也要尊重简单重复比额外参数抽象更直观的情况。不得因缺少映射表、依赖注入或某种设计模式扣分。',
    anchors: { A: '抽象程度合适，直观写法得以保留。', B: '一处辅助抽象略显多余或略可统一。', C: '一处抽象使简单逻辑需要额外跳转，或明显可统一的逻辑散落。', D: '多层无意义封装或多组应统一的逻辑明显妨碍理解。', E: '核心代码被过度拆分或抽象失位主导，简单行为也要跨多层追踪。' }
  },
  {
    id: 'local_comprehensibility', title: '局部可理解性', scope: 'file', category: 'readability', weight: 3,
    focus: '评价一段本来简单的逻辑是否需要频繁跳到其他函数或文件才能理解。只在这些跳转无助于职责划分时扣分；合理模块边界、复用或必要的领域接口不扣分。不按调用次数或文件数机械判定。',
    anchors: { A: '局部代码能在当前上下文中理解。', B: '偶尔需要跳转一次，影响很小。', C: '简单逻辑被一次不必要的跳转打断。', D: '多个简单步骤被拆散，读者要反复跳转。', E: '核心行为被碎片化到多处，局部几乎看不到完整意图。' }
  },
  {
    id: 'module_boundaries', title: '模块职责边界', scope: 'project', category: 'architecture', weight: 1,
    focus: '判断模块组织是否帮助理解同一目的的代码。允许一个模块完成相关的多个步骤，也允许不同合理架构；不凭目录数量、文件长度或是否使用特定分层扣分。',
    anchors: { A: '模块组织支持理解同一目的的代码。', B: '一处边界略模糊但容易定位。', C: '一处无关职责混入或相关简单逻辑无益地被拆散。', D: '多个关键模块的边界妨碍定位与阅读。', E: '项目核心组织系统性割裂或混杂职责。' }
  },
  {
    id: 'dependency_direction', title: '依赖关系清晰度', scope: 'project', category: 'architecture', weight: 1,
    focus: '依据可见导入与调用关系判断依赖是否容易追踪；不重复本地导入环，也不要求依赖注入、固定分层或单一架构模式。',
    anchors: { A: '依赖关系容易追踪。', B: '一处依赖略绕，但仍清楚。', C: '一组依赖增加了不必要的跨模块跳转。', D: '多个关键关系交错，定位逻辑需要反复往返。', E: '项目核心依赖关系过度绕行，简单操作难以追踪。' }
  },
  {
    id: 'cross_file_contracts', title: '跨文件写法一致性', scope: 'project', category: 'consistency', weight: 2,
    focus: '只比较相似操作的命名、控制流与异常处理写法；不同语言或职责可以有不同习惯。不能要求统一所有实现，更不能判断业务结果是否正确。',
    anchors: { A: '相似操作的写法一致或差异有清楚理由。', B: '一处次要差异。', C: '一组相似操作写法明显不一致。', D: '多处同类操作采用冲突写法，阅读负担较大。', E: '项目同类操作系统性风格分裂。' }
  }
]);

export const FILE_AI_CRITERIA = AI_CRITERIA.filter(item => item.scope === 'file');
export const PROJECT_AI_CRITERIA = AI_CRITERIA.filter(item => item.scope === 'project');

export function criterionById(id: string): AiCriterion | undefined { return AI_CRITERIA.find(item => item.id === id); }
export function gradePoints(grade: AiGrade, weight: number): number { return AI_BASE_POINTS[grade] * weight; }
