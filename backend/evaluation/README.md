# Agentic RAG 评估集

`datasets/agentic-rag-golden-v1.jsonl` 是基于仓库内两份测试知识文档构建的首版黄金集：

- `test-files/01-travel-expense-policy.pdf`
- `test-files/02-production-release-sop.pdf`

它对应当前系统的实际链路：问题分析与上下文改写 → 策略选择 → 向量/关键词/图谱检索 → WRRF 融合 → Rerank → 生成 → 答案评估与迭代。

## 数据结构

每行是一条独立 JSON：

- `id`：稳定样本编号。
- `slice`：评估切片，用于定位具体能力退化。
- `question` / `history`：本轮输入和可选的历史对话。
- `expected_analysis`：期望意图、检索判断、改写关键词和实体词。`acceptable_intents` 可声明多个合理意图；`rewritten_contains` 的嵌套数组表示同义表达命中任意一个即可。
- `expected_strategy`：期望的文本检索类型及是否启用知识图谱。`null` 表示应直接回答。
- `gold.document_titles`：期望召回的文档标题；跨文档问题应全部命中。
- `gold.evidence_groups`：黄金证据组。外层数组表示“必须全部覆盖的证据点”，同一个内层数组中的字符串应在同一召回片段中共同出现。
- `gold.required_facts`：最终回答必须表达的事实，可做语义匹配或 LLM Judge。
- `gold.forbidden_facts`：答案不得声称的内容，用于检测幻觉和错误数字。
- `tags`：更细粒度的能力标签。

`expected_strategy` 描述的是当前代码应产生的可观测行为。自然语言中包含 `SOP-PE-2026-003`、`CRM`、`SRE` 等精确词时使用关键词增强的 Hybrid，不再关闭向量或关系题所需的图谱；只有输入本身是纯编号/版本号时才使用 keyword-only，并在零召回时回退向量检索。`P99`、`M3` 这类单字母加数字术语仍作为 `routing-edge` 保留，用于观察精确词识别边界。

## 推荐指标

建议分层统计，不要只看一个总分：

1. **分析与路由**
   - Intent Accuracy
   - Retrieval Decision Accuracy
   - Strategy Accuracy
   - Knowledge Graph Routing Accuracy
   - Conversation Rewrite Pass Rate
   - Entity Term Recall

2. **检索**
   - Gold Document Recall@K
   - Evidence Group Recall@K
   - All-evidence Success Rate：一条多跳样本的全部证据组是否都被召回
   - MRR / NDCG：补充标注相关 chunk 后再计算
   - 各来源消融：vector only、keyword only、graph only、fusion

3. **回答**
   - Required Fact Coverage
   - Forbidden Fact Violation Rate
   - Citation Correctness
   - Groundedness / Faithfulness
   - Unanswerable Calibration：知识库缺失时是否明确说明无法确认

4. **Agent 过程与工程指标**
   - Task Success Rate
   - Follow-up Iteration Rate 与有效提升率
   - 平均迭代次数、无效循环率
   - P50/P95 端到端延迟
   - Token 与模型调用成本

## 判分建议

检索阶段可以先采用可复现的字符串证据判分：对每个召回 chunk 做 Unicode NFKC 归一化、去除多余空白，再判断每个 `evidence_group` 是否在某个 chunk 中完整出现。随后再补充语义 Judge，避免 PDF 字符抽取差异导致假阴性。

回答阶段建议使用“确定性规则 + LLM Judge”组合：

- `required_facts` 做语义覆盖判断，而不是严格字符串相等。
- `forbidden_facts` 先做字符串/数字规则检查，再由 Judge 判断是否真的作出了该断言。
- `answerable=false` 的样本必须表达“知识库未提供/无法确认”，不能根据相邻城市或常识猜测。
- 引用必须支持紧邻的答案事实，不能只要求引用来自正确文档。

推荐先将每个阶段等权汇总为 100 分：分析与路由 20、检索 35、回答与引用 35、延迟与成本 10。正式对外报告时同时展示各 slice 得分，避免总分掩盖关键词、图谱或多轮场景的短板。

## 校验

在 `backend` 目录运行：

```bash
node evaluation/validate-dataset.mjs
```

## 批量运行

批量评估通过真实的 `/rag/chat/stream` SSE 接口执行，因此运行前需要：

1. 启动 PostgreSQL、MongoDB、Elasticsearch、Neo4j、RabbitMQ 和后端服务。
2. 将两份测试 PDF 发布并完成向量索引、关键词索引和知识图谱构建。
3. 准备一个可登录的测试用户或 JWT。

> 文档解析规则更新后，已有文档不会自动重写历史 chunk。需重新解析并重建向量、关键词和图谱索引后，检索才能受益于文本归一化修复；仅重新跑评估不会改变已入库的内容。

在 `backend` 目录先运行少量样本确认环境：

```bash
EVAL_TOKEN='<jwt>' pnpm eval:dataset -- \
  --limit 3 \
  --output evaluation/reports/smoke.json
```

确认后运行完整评估：

```bash
EVAL_TOKEN='<jwt>' pnpm eval:dataset -- \
  --concurrency 2 \
  --max-iterations 2 \
  --output evaluation/reports/full.json
```

只运行知识图谱切片：

```bash
EVAL_TOKEN='<jwt>' pnpm eval:dataset -- --slice knowledge-graph
```

常用参数可通过 `pnpm eval:dataset -- --help` 查看。默认并发为 1，建议确认模型、Embedding、Elasticsearch 和 Neo4j 的限流能力后再提高。Runner 默认删除评估过程中创建的会话；调试时可加 `--keep-conversations`。

Runner 会以 `evaluationMode=true` 请求聊天接口，使检索事件携带完整 chunk；普通聊天仍只返回 200 字预览。PASS/FAIL 的任务门禁包括检索决策、检索策略、图谱路由、黄金文档、完整证据、禁止事实、无答案校准和答案非空。意图、改写关键词和实体词仍会统计，但不会因合理意图歧义或同义改写直接判整条任务失败。

报告的 `summary.metrics` 按层输出正式指标，包括分析与路由准确率、Gold Document Recall、Evidence Group Recall、All-evidence Success Rate、无答案校准、禁止事实违规率、平均迭代次数、Follow-up 比例和 P50/P95 延迟。`required_facts` 的字面覆盖率只作为观察值，因为生成答案通常存在同义表达；正式评估仍建议增加 LLM Judge 进行语义事实覆盖与引用忠实度判分。

修改黄金集或评分规则后，可以用已有报告快速重新判分，不调用后端和大模型：

```bash
pnpm eval:dataset -- \
  --replay evaluation/reports/full.1.json \
  --output evaluation/reports/full.1.rescored.json
```

历史报告中的召回内容如果已经被截断为 200 字，离线重判无法恢复完整证据，因此 Evidence Group Recall 的修复效果需要重新在线运行一次完整评估。

首版数据适合做开发集和流程打通，不应直接作为最终测试集。后续应从真实用户 Trace 中抽取失败样本，去重并人工标注后建立独立、冻结的 test split；调 Prompt 或路由规则时只看 dev split，避免评估集过拟合。
