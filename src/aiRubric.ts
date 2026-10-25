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

export const AI_RUBRIC_VERSION = '3.0';
export const AI_BASE_POINTS: Readonly<Record<AiGrade, number>> = Object.freeze({ A: 0, B: 2, C: 4, D: 6, E: 10 });

/** This is the only source for AI criteria, weights and grade anchors. */
export const AI_CRITERIA: readonly AiCriterion[] = Object.freeze([
  {
    id: 'boundary_safety', title: '边界与输入安全', scope: 'file', category: 'correctness', weight: 3,
    focus: '只判断可见输入路径是否发生未被预期的失败或数据破坏；空值可作为合法结果或异常信号，主动抛错和由调用方处理也可合理。没有业务契约时不得仅因缺少空值检查或出现异常扣分。',
    anchors: { A: '可见边界的结果或失败方式合理，包含约定的空值与异常。', B: '次要边界失败方式略不一致，但不会伪装成功。', C: '已证明可达的边界输入造成一处未预期失败或错误状态。', D: '多个关键边界产生未预期失败且未正确传递。', E: '常见边界导致核心流程失控或数据破坏，并有明确可达证据。' }
  },
  {
    id: 'resource_lifecycle', title: '资源与状态生命周期', scope: 'file', category: 'correctness', weight: 3,
    focus: '检查文件、锁、连接、内存或共享状态是否正确获取、释放及恢复；必须指出可见的泄漏或状态路径。',
    anchors: { A: '可见资源与状态生命周期闭合。', B: '局部清理路径略难追踪。', C: '一个错误路径遗漏释放或恢复。', D: '多个重要路径泄漏资源或污染状态。', E: '核心资源或共享状态持续失控。' }
  },
  {
    id: 'semantic_naming', title: '命名语义', scope: 'file', category: 'naming', weight: 1,
    focus: '名称是否准确表达对象、动作和结果；短作用域的 temp 等临时名不自动视作缺陷。',
    anchors: { A: '名称准确，能从上下文理解职责。', B: '少量名称略泛，但上下文可辨认。', C: '一个重要名称误导理解或需反复追踪。', D: '多个关键名称模糊或与行为不符。', E: '核心接口或数据名称系统性误导，难以安全修改。' }
  },
  {
    id: 'function_cohesion', title: '函数职责内聚', scope: 'file', category: 'architecture', weight: 2,
    focus: '函数是否把互不相关的职责混在一起；不能仅凭函数长度判定。',
    anchors: { A: '函数职责集中，边界清楚。', B: '少量辅助步骤混入，但主职责明确。', C: '一个函数混合两个可分离的职责。', D: '关键函数混合多项职责且产生明显耦合。', E: '核心逻辑成为难以拆分和测试的职责汇集点。' }
  },
  {
    id: 'error_strategy', title: '异常与失败处理', scope: 'file', category: 'correctness', weight: 2,
    focus: '失败只需被正确传递、显式返回、记录或恢复，不要求当前函数捕获异常，也不要求知道最终如何恢复。只有可见的吞错、伪装成功、错误恢复或状态破坏才扣分；不重复本地空 catch/except。',
    anchors: { A: '可见失败被正确传递、返回、记录或恢复。', B: '次要失败路径的信号略含糊，但调用方仍可识别。', C: '一处重要失败被误报为成功或丢失必要错误信息。', D: '多个重要失败路径吞错、错误恢复或误导调用方。', E: '核心失败被系统性掩盖，导致持续错误状态。' }
  },
  {
    id: 'semantic_duplication', title: '语义重复与抽象', scope: 'file', category: 'duplication', weight: 2,
    focus: '相同业务逻辑是否在不同位置重复；不重复本地完全相同代码块。',
    anchors: { A: '未见有维护负担的语义重复。', B: '少量相似流程，变更成本较低。', C: '一组业务规则重复，需同步修改。', D: '多组关键逻辑重复且已有分叉风险。', E: '核心规则大面积复制，修复难以保持一致。' }
  },
  {
    id: 'complexity_fit', title: '复杂度与问题匹配', scope: 'file', category: 'complexity', weight: 2,
    focus: '结构是否比实际需求更难理解；不重复本地圈复杂度、嵌套和函数长度结论。',
    anchors: { A: '结构与任务复杂度相称。', B: '有轻微不必要的间接层。', C: '一处明显的复杂流程可简化。', D: '多个关键流程存在不必要的状态或分支。', E: '核心实现过度复杂，行为难以验证。' }
  },
  {
    id: 'performance_risk', title: '性能风险', scope: 'file', category: 'correctness', weight: 2,
    focus: '仅在可见输入规模与算法、循环或 I/O 路径能证明明显退化时评分；不适用时给 N/A。',
    anchors: { A: '可见规模下没有明显性能退化。', B: '次要路径存在小幅浪费。', C: '一个常用路径有可证明的明显浪费。', D: '关键路径在预期规模下显著退化。', E: '核心路径在常见规模下不可用。' }
  },
  {
    id: 'module_boundaries', title: '模块职责边界', scope: 'project', category: 'architecture', weight: 3,
    focus: '依据提供的路径、导入和片段检查模块职责；不能仅凭文件大小或无导入判定。',
    anchors: { A: '已审查的模块职责边界清楚。', B: '一处边界略模糊但影响局部。', C: '两个模块职责交叉，修改需跨边界协调。', D: '多个核心模块职责混杂。', E: '项目核心模块没有稳定边界，改动广泛扩散。' }
  },
  {
    id: 'dependency_direction', title: '依赖方向', scope: 'project', category: 'architecture', weight: 3,
    focus: '依据真实导入/调用关系判断层次与耦合；不重复本地已发现的导入环。',
    anchors: { A: '已审查的依赖方向清楚。', B: '一处依赖方向不理想但影响有限。', C: '关键模块存在可核查的反向依赖。', D: '多个模块相互依赖，边界难以维护。', E: '核心依赖结构系统性倒置或高度耦合。' }
  },
  {
    id: 'cross_file_contracts', title: '跨文件约定一致性', scope: 'project', category: 'consistency', weight: 3,
    focus: '同类接口、错误语义或数据约定是否一致；不同语言的正常惯例不算问题。',
    anchors: { A: '已审查的同类约定一致。', B: '一个次要接口约定略有差异。', C: '同类接口的一处重要约定不一致。', D: '多处关键接口约定冲突。', E: '跨模块契约系统性不一致，调用方难以可靠使用。' }
  },
  {
    id: 'testability', title: '可测试性', scope: 'project', category: 'architecture', weight: 2,
    focus: '依据可见模块接口、依赖注入和测试代码判断关键行为是否可隔离验证；不能仅凭没有测试文件扣分。',
    anchors: { A: '关键行为可隔离验证。', B: '局部依赖使测试略繁琐。', C: '一个核心模块难以隔离测试。', D: '多个核心行为只能通过脆弱的整体环境测试。', E: '核心行为缺乏可验证边界。' }
  },
  {
    id: 'state_consistency', title: '跨模块状态一致性', scope: 'project', category: 'correctness', weight: 3,
    focus: '检查跨模块状态更新、缓存和数据约定的实际同步路径；须给出可见的失配证据。',
    anchors: { A: '可见状态更新路径一致。', B: '次要状态同步略含糊。', C: '一个可达路径造成状态失配。', D: '多个关键模块存在状态失配。', E: '核心状态在常见操作下系统性不一致。' }
  },
  {
    id: 'security_boundaries', title: '安全边界', scope: 'project', category: 'security', weight: 4,
    focus: '仅在项目涉及不可信输入、权限或敏感数据时检查注入、授权和泄露；无此类边界时给 N/A。必须指出可见攻击路径。',
    anchors: { A: '可见安全边界得到验证。', B: '局部保护说明不充分。', C: '一个可达边界存在有限风险。', D: '重要入口存在可利用的边界缺陷。', E: '核心入口可直接导致严重越权、注入或泄露。' }
  }
]);

export const FILE_AI_CRITERIA = AI_CRITERIA.filter(item => item.scope === 'file');
export const PROJECT_AI_CRITERIA = AI_CRITERIA.filter(item => item.scope === 'project');

export function criterionById(id: string): AiCriterion | undefined { return AI_CRITERIA.find(item => item.id === id); }
export function gradePoints(grade: AiGrade, weight: number): number { return AI_BASE_POINTS[grade] * weight; }
