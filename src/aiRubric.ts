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

export const AI_RUBRIC_VERSION = '6.0';
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
    focus: '只有同一段实质性逻辑至少出现三处，且统一后确实更清楚时才可给 B–E；每处须在 issues 列出不同的可核查起始行。两处相同代码、单行调用或少量局部步骤均给 A，不因存在重复或可能同步修改就扣分。接口实现与统一转发不属于不必要的重复。',
    anchors: { A: '少于三处实质性重复，或保留重复更直观。', B: '至少三处实质性重复，统一后略能减轻明确的维护负担。', C: '至少三处同类逻辑反复出现，清楚的统一方式能减少维护负担。', D: '多组实质性逻辑反复复制，明显妨碍阅读或修改。', E: '核心规则被大量复制，且存在简单清楚的统一方式。' }
  },
  {
    id: 'control_flow_clarity', title: '控制流清晰度', scope: 'file', category: 'readability', weight: 2,
    focus: '评价深层嵌套、复杂条件或跳转是否真的妨碍追踪。长 if-else 分发若顺序清楚可评 A；不得仅因为没改用映射表、策略模式，或分支较多就扣分。不重复本地圈复杂度与嵌套数字。',
    anchors: { A: '执行路径容易追踪，长分支也可清楚。', B: '一处轻微绕行但不妨碍理解。', C: '一处嵌套或条件组合需要反复追踪。', D: '多个重要路径难以追踪。', E: '核心控制流层层绕行，局部难以判断接下来执行什么。' }
  },
  {
    id: 'expression_simplicity', title: '表达简洁性', scope: 'file', category: 'readability', weight: 2,
    focus: '只判断不必要的中间变量、状态或无职责的私有辅助层是否增加阅读成本。接口封装、适配器、公共入口与统一转发本身都有明确用途，不能因为只转发一次或多一层调用而扣分。有助于命名与解释的中间变量应保留。',
    anchors: { A: '表达直接；接口封装、转发与辅助变量有清楚用途。', B: '一处与接口无关的轻微多余步骤。', C: '一处无职责的私有中间层明显打断阅读。', D: '多个冗余变量、状态或私有层迫使读者追踪。', E: '核心流程主要由与接口无关的无意义间接层组成。' }
  },
  {
    id: 'abstraction_fit', title: '抽象恰当性', scope: 'file', category: 'architecture', weight: 3,
    focus: '接口封装、适配器、门面和统一转发的公共入口均是合理抽象，不能因只转发或增加一层调用扣分。仅在非接口的私有辅助链有多个无职责层、明显妨碍理解时判断过度抽象；不因少量重复或缺少某种模式扣分。',
    anchors: { A: '接口封装与统一转发合理，私有抽象层次也清楚。', B: '一处与接口无关的私有辅助层略显多余。', C: '非接口的私有层明显增加无益跳转。', D: '多个无职责私有层明显妨碍理解。', E: '核心简单行为被多层无职责私有调用链主导。' }
  },
  {
    id: 'local_comprehensibility', title: '局部可理解性', scope: 'file', category: 'readability', weight: 3,
    focus: '评价简单逻辑是否被无职责的私有调用链拆散。通过接口、适配器或统一转发入口跳到实现是合理边界，即使需要跳转也不得因此扣分；不能把一次跳转或调用次数本身当作问题。',
    anchors: { A: '接口调用与局部代码都能在合理边界内理解。', B: '一处与接口无关的私有绕行，影响很小。', C: '无职责的私有跳转明显打断简单逻辑。', D: '多个简单步骤被私有层拆散，需要反复跳转。', E: '核心行为被无职责私有调用链碎片化。' }
  },
  {
    id: 'module_boundaries', title: '模块职责边界', scope: 'project', category: 'architecture', weight: 1,
    focus: '判断模块组织是否帮助理解同一目的的代码。接口封装、适配器和统一转发入口是合理模块边界；允许一个模块完成相关多个步骤，不凭目录数量、文件长度或固定分层扣分。',
    anchors: { A: '模块组织支持理解同一目的的代码。', B: '一处边界略模糊但容易定位。', C: '一处无关职责混入或相关简单逻辑无益地被拆散。', D: '多个关键模块的边界妨碍定位与阅读。', E: '项目核心组织系统性割裂或混杂职责。' }
  },
  {
    id: 'dependency_direction', title: '依赖关系清晰度', scope: 'project', category: 'architecture', weight: 1,
    focus: '依据可见导入与调用关系判断依赖是否容易追踪；通过接口、门面或统一转发入口访问实现是合理依赖方向，不因多一跳扣分。不重复本地导入环，也不要求依赖注入或固定分层。',
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
