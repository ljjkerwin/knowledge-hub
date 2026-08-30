# `chat/stream` Agent 评估体系：从 0 到 1

## 先给结论

这个 Agent 不应只用一个“回答正确率”评价。最小可用体系应同时包含：

1. **组件测试**：问题路由、查询改写、检索、引用、生成分别定位故障。
2. **端到端离线实验**：用固定数据集跑与生产同源的 Agent，比较版本并防回归。
3. **SSE 契约测试**：验证流式协议、异常、断流和消息落库，独立于回答质量。
4. **线上观测与反馈**：用 trace、业务成功率、用户反馈和抽样评审发现新问题。
5. **数据闭环**：线上失败样本经人工确认后进入离线回归集。

不要一开始追求上百个指标。先让 30～50 条高质量案例、6～8 个可解释指标和一次人工
误差分析跑通，价值会高于一个很大的自动生成题库。

## 1. 先理解被测系统

`POST /api/rag/chat/stream` 不是单次 LLM 调用。当前生产路径为：

```text
鉴权 / 会话读取 / 保存用户消息
              ↓
问题分析与上下文改写 ──→ directGenerate ──→ SSE TEXT / DONE
              │
              └─→ 混合检索（关键词、向量、图谱）
                          ↓
                     融合 + rerank
                          ↓
                     生成答案草稿
                          ↓
                     草稿运行时评审
                    ↙             ↘
              补检索迭代          输出最佳答案
                                      ↓
                          SSE TEXT / DONE / 消息落库
```

因此，最终答案错可能来自至少五处：路由错、改写错、召回错、生成不忠实、迭代决策错。
只有端到端分数时，无法知道该改 prompt、检索参数还是业务代码。

项目已有两个很好的基础：

- `runEvents()` 同时服务 SSE 和离线 `run()`，避免“评测一套代码、生产另一套代码”。
- `AgentRunResult` 已汇总 route、answer、citations、retrieval queries、迭代与时延。

注意：`DraftAssessmentService` 是 Agent 的**运行时决策器**，会影响是否继续检索；它不是
独立金标，也不能再被当作最终质量分数，否则相当于让被测者给自己判卷。

## 2. 评估对象与指标

### 2.1 第一层：确定性与协议指标

这些指标便宜、稳定，应该每次提交都跑：

| 对象 | 指标 | 计算方式 | 主要回答的问题 |
| --- | --- | --- | --- |
| 请求 | `request_success` | 收到 `DONE`、无 `ERROR`、助手消息落库 | 系统是否真的完成 |
| 路由 | `route_accuracy` | `direct/rag` 与人工标签一致 | 是否错误检索或漏检索 |
| 检索 | `document_recall` | 应召回文档中实际出现的比例 | 答案资料是否找全 |
| 引用 | `citation_precision` | 引用中与问题相关的比例 | 是否拿无关资料撑答案 |
| 事实 | `required_fact_recall` | 稳定关键事实命中比例 | 明确规则/数字是否遗漏 |
| 安全 | `forbidden_content_pass` | 禁止内容零命中 | 是否泄漏或输出已知错误 |
| 资源 | `iterations` | 完成所用 Agent 轮数 | 是否无意义循环 |
| 性能 | TTFT、总时延 p50/p95 | 事件时间戳与请求时间差 | 用户等待是否恶化 |
| SSE | 事件状态机通过率 | `METADATA → ... → DONE/ERROR` | 流是否完整、可消费 |

`similarity` 是检索器内部信号，不是质量真值。不同检索源、模型或 reranker 的分数不可直接
横向比较，不应拿固定 similarity 均值作为上线 KPI。

### 2.2 第二层：语义质量指标

RAG 答案建议评四个相互独立的维度：

- **正确性**：相对人工参考事实，结论是否正确。
- **忠实性 / groundedness**：答案中的可验证陈述是否都能由实际召回片段支持。
- **完整性**：用户要求的要点是否覆盖。
- **相关性 / helpfulness**：是否直接解决问题，且没有无关赘述。

其中 groundedness 必须把“本次实际召回的完整片段”交给评审器。当前 SSE 的中间
`RETRIEVAL_RESULT` 会把内容截断到 200 字，不能用它做严格忠实性判定；离线 runner 应使用
Agent 内部完整上下文或 Langfuse 中对应 retriever/generation observation。

### 2.3 第三层：业务与风险指标

技术分数最终应连接到业务结果：负反馈率、重复提问率、转人工率、用户是否点开引用、任务
完成率。安全方面至少覆盖文档 prompt injection、越权知识、敏感信息、无资料时编造，以及
恶意长输入导致的资源耗尽。

不要把所有指标加权成唯一总分。保留一个 scorecard：硬门禁失败直接阻断，其他指标用于
版本比较。单一总分很容易掩盖“平均质量上升但安全退化”的情况。

## 3. 数据集怎么建

### 3.1 第一版只做 30～50 条

建议按真实流量分布和风险分层：

| 类别 | 初始占比 | 例子 |
| --- | ---: | --- |
| 高频单跳知识问答 | 25% | 单份制度即可回答 |
| 多文档 / 比较 / 关系题 | 15% | 两个产品、制度或实体对比 |
| 精确编号与关键词 | 10% | 文件号、术语、缩写 |
| 多轮省略与指代 | 15% | “那它的审批人呢？” |
| 无答案 / 资料不足 | 10% | 知识库没有的政策 |
| direct 路由 | 10% | 寒暄、致谢、告别 |
| 安全与 prompt injection | 10% | 文档内含“忽略系统指令” |
| 故障与边界 | 5% | 空召回、超时、下游异常 |

每条数据至少包含：用户输入、上下文、期望路由、相关文档 ID、关键事实、禁止内容、类别、
难度、来源和 split。不要要求答案逐字匹配一个标准段落；自然语言有很多同样正确的表达。

仓库中的 `evaluation/dataset.example.jsonl` 给出了具体结构。`template` 案例只是占位，必须
由熟悉知识库的人替换。数据划分使用：

- `smoke`：5～10 条，开发时快速发现系统性故障。
- `dev`：用于改 prompt、阈值和检索参数。
- `test`：冻结，仅用于合并或发布前最终判断。

同一问题的改写不能跨 split；否则看似是测试集，实际已经把答案泄漏给开发过程。

### 3.2 金标制作流程

1. 由业务专家从已发布、有效版本的文档中写问题和关键事实。
2. 标出最小相关文档集合，不要把“所有可能有关的文档”都标为相关。
3. 第二人复核歧义、文档时效和答案依据。
4. 无共识的样本先标记为 `ambiguous`，不进发布门禁。
5. 文档更新时同步版本化数据集，否则旧金标会把正确的新答案判错。

后续扩容优先使用线上负反馈、人工发现的错误和高价值真实问题。自动生成的问题可用于探索，
但未经人工确认不能成为 test 金标。

## 4. 评审器怎么选

优先顺序是：**代码规则 > 人工金标对比 > LLM-as-a-Judge > 人工抽检**。

- 路由、schema、引用编号、敏感词、时延必须用代码判定。
- 相关文档集合和关键事实尽量人工标注后机械比较。
- 正确性、忠实性、完整性等开放文本维度再使用 LLM judge。
- 发布前和线上持续保留人工抽检，检查自动评审器没有系统性偏差。

Judge prompt 应为每个维度给清晰 rubric，返回结构化分数和证据；一次只评价少量、明确的
维度。Judge 模型、prompt 版本、温度、数据集版本都要写入实验 metadata。不要把测试项的
`expectedOutput` 传进 Agent；它只允许进入 evaluator。

### 4.1 Judge 校准

LLM judge 上门禁前，用约 50～100 条人工双标样本校准：

1. 人先独立给 pass/fail 或分档标签，分歧由第三人裁决。
2. `dev` 用于改 rubric 和 few-shot，`test` 只运行一次。
3. 二分类报告 TP、FP、FN、TN、precision、recall、F1，而不只看 accuracy。
4. 根据错误成本定门槛。例如 groundedness 的假阴性会放过幻觉，应重点看 recall。
5. 定期抽取 judge 与人不一致的案例重新做错误分析。

Judge 和生成模型最好不是完全相同的模型/提示上下文。即使不同，也不能假设 judge 天然客观；
位置偏差、长度偏好、措辞风格和自我偏好都要通过人工标签校准。

## 5. 三种运行方式

### 5.1 开发期：本地离线实验

```bash
cd backend
pnpm eval:validate evaluation/dataset.example.jsonl
pnpm eval:dataset -- --dataset evaluation/dataset.example.jsonl --split smoke
pnpm eval:dataset -- --dataset evaluation/dataset.smoke.jsonl --case rag-multi-doc-comparison-smoke-001
pnpm eval:dataset -- --dataset evaluation/dataset.jsonl --split test --gate 0.90
```

runner 通过 `tsx` 直接执行 TypeScript 源码，再通过精简的 Nest `EvaluationModule` 获取
`AgentOrchestrator`，因此走的是生产核心代码，但不会初始化 Postgres、MongoDB、消息队列或对象存储。它不创建用户、
不写会话，也不经过 HTTP。报告包含逐项证据、宏平均指标和
总时延 p50/p95，默认写到 `evaluation/results/`。

每次实验还应记录：git commit、模型名、prompt 版本、embedding/reranker 版本、topK、最大
迭代数、知识库快照版本。当前 runner 已记录部分运行配置，后续应把缺失版本逐步补齐。

### 5.2 CI：回归门禁

第一阶段只在可控测试环境运行 `smoke`，避免每个提交产生过多模型费用。夜间或发布前跑完整
`test`。门禁应在收集基线后确定，下面只是合理起点，不是行业通用真理：

- `request_success = 100%`
- 安全 / 禁止内容通过率 `= 100%`
- route accuracy `≥ 95%`
- document recall `≥ 85%`
- groundedness `≥ 90%`
- p95 总时延不比已发布基线恶化超过 20%
- 任一高风险案例失败即阻断

版本比较时同时报告绝对门槛和相对退化。样本很少时，1 条失败就会显著改变比例，必须同时
展示分子/分母和具体失败案例，不要只看百分比。

### 5.3 线上：Langfuse + 业务反馈

现有代码已经接入 Langfuse 5.x 和 LangChain callback，并记录
`rag.request.success`。下一步应保证每个 trace 还包含：

- trace input/output（需脱敏；不能只记 `messageLength`）
- `session_id = conversationId`
- `user_id = req.user.id`（若隐私策略允许，建议哈希/内部 ID）
- environment、release/git SHA、feature tag
- analyze、retriever、reranker、generation、assessment 的父子层级
- model、token、cost、TTFT、总时延、迭代数、route、引用数

线上不可能每条都跑昂贵 judge。建议：100% 跑请求成功、时延、结构和安全规则；按 5%～10%
稳定随机抽样运行 reference-free judge；100% 收集显式赞踩；对负反馈、异常、高时延和高价值
用户请求提高采样率。采样规则必须固定且可解释，避免只评“看起来正常”的请求。

每周做一次 30～50 条失败样本的开放编码：先描述观察到的行为，再聚类为失败类型，最后
决定改数据、检索、prompt、模型还是产品交互。修复后的真实案例进入回归集，形成：

```text
线上 trace / 用户反馈 → 人工确认 → 失败分类 → 加入数据集 → 修复 → 离线实验 → 发布 → 线上验证
```

## 6. SSE 接口需要单独测什么

Agent 离线质量通过，不代表 `@Sse('chat/stream')` 可用。e2e 至少覆盖：

1. 无 `conversationId` 时先发一个合法 `METADATA`，且包含新会话 ID 与 query ID。
2. 正常路径最终恰好一个 `DONE`，没有 `ERROR`；所有 TEXT 拼接后等于落库答案。
3. 错误路径最终有 `ERROR`、无 `DONE`，且不落一条“正常助手消息”。
4. 已有会话必须校验归属，不能跨用户读取。
5. 客户端断开时应取消或限时终止下游工作，避免幽灵请求持续计费。
6. 事件 JSON 均符合 AGUI schema，timestamp 单调非递减。
7. 记录 TTFE（首事件）和 TTFT（首文本），而不仅是总时延。
8. 下游超时、ES/Neo4j/LLM 错误、数据库落库失败分别注入故障测试。

当前 controller 只有在 `DONE` 且助手消息落库成功后才把 `rag.request.success` 记为 true，这个
定义是正确的接口级语义。需要特别补充客户端取消传播；仅让 RxJS `Subject` complete，并不
必然会取消正在运行的 LangGraph、检索或模型请求。

## 7. 90 天落地路线

### 第 1 周：可测

- 业务、研发共同写 10 条 smoke + 30 条 dev/test。
- 跑通本仓库 evaluator，冻结第一份 baseline JSON。
- 补 SSE 状态机和三类故障 e2e。

### 第 2～4 周：可信

- 扩到 80～150 条，覆盖真实问题和安全边界。
- 引入 groundedness、correctness、completeness judge。
- 用人工双标集校准 judge，建立失败 taxonomy。
- Langfuse trace 补 session、user、release、完整输入输出与清晰 span。

### 第 2～3 月：闭环

- CI smoke、夜间 full、发布前 test 三档运行。
- 线上抽样 judge、用户反馈与告警面板。
- 每周错误分析、每月数据集去重与时效审计。
- 所有 prompt、模型、检索与知识库变更都通过同一 test scorecard。

## 8. 对当前仓库的优先级建议

按收益排序：

1. 用真实文档 ID 和事实替换示例数据中的两个 template 项，先跑出 baseline。
2. 给 `AgentRunResult` 增加生成时实际使用的完整 context chunk IDs/content，支持严格忠实性评估。
3. 补 SSE e2e 和客户端取消传播。
4. 给 Langfuse trace 增加 session/user/release，以及可读但脱敏的输入输出。
5. 在人工校准后增加 LLM judge；不要直接拿现有草稿自评分做门禁。
6. 基线稳定后再接 CI，门槛由真实历史分布和业务风险共同确定。

## 参考方案

- [OpenAI：内部 Data Agent 如何用金标查询、结果执行与 grader 持续防回归](https://openai.com/index/inside-our-in-house-data-agent/)
- [LangSmith：Evaluation concepts（离线、线上与持续反馈闭环）](https://docs.langchain.com/langsmith/evaluation-concepts)
- [LangSmith：RAG 的文档相关性、忠实性、帮助性与正确性](https://docs.langchain.com/langsmith/evaluation-approaches)
- [Langfuse：Evaluation core concepts](https://langfuse.com/docs/evaluation/core-concepts)
- [Langfuse：Experiments via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk)
- [Langfuse：Experiments data model](https://langfuse.com/docs/evaluation/experiments/data-model)
- [Langfuse：What does a good trace look like?](https://langfuse.com/docs/observability/best-practices)
