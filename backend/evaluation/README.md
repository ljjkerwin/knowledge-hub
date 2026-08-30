# Agent 评估运行器

这套运行器直接调用 `AgentOrchestrator.run()`。它与 `POST /api/rag/chat/stream`
共享 `runEvents()` 生产执行路径，但跳过鉴权、HTTP、会话创建和消息落库，适合可重复的
离线质量实验。SSE 协议与持久化应由单独的 e2e 测试覆盖。

## 快速开始

1. 复制 `dataset.example.jsonl`，把带 `template` 的行替换成真实知识库案例。
2. 给每条 RAG 案例填写真实 `documentId` 和可机械核验的关键事实。
3. 确保 `.env` 中数据库、Elasticsearch、Neo4j、Embedding 和 LLM 配置可用。

```bash
cd backend
pnpm eval:validate evaluation/dataset.example.jsonl
pnpm eval:dataset -- --dataset evaluation/dataset.example.jsonl --split smoke
pnpm eval:dataset -- --dataset evaluation/dataset.smoke.jsonl --case rag-single-hop-smoke-001
pnpm eval:dataset -- --dataset evaluation/dataset.smoke.jsonl --case-index 1
pnpm eval:dataset -- --dataset evaluation/dataset.smoke.jsonl --retrieval-k 5
pnpm eval:dataset -- --dataset evaluation/dataset.example.jsonl --split smoke --judge
pnpm eval:dataset -- --dataset evaluation/dataset.jsonl --split test --gate 0.90
```

runner 使用独立的 `EvaluationModule`，不会连接 HTTP、Postgres、MongoDB、消息队列或
对象存储。报告写入 `evaluation/results/`。`--gate` 接受 0 到 1 的最低案例通过率，低于门槛时
进程以状态码 2 退出。

`--case <id>` 只运行指定 case；`--case-index <n>` 按数据集中的第 `n` 条 case 运行（从 1 开始）。
与 `--split` 组合时，序号在该 split 的筛选结果中计算；两者不可同时使用。

`summary.metrics` 只保留蛇形命名的核心指标：`request_success_rate`、`route_accuracy`、
`document_recall_at_k`、`required_fact_recall`、`groundedness`、`no_answer_accuracy` 和
`time_to_first_text_ms`。各条件指标的样本量在 `summary.metric_samples` 中；没有无答案样本时
`no_answer_accuracy` 为 `null`。引用精度、禁用内容等附加检查放在 `summary.diagnostics`。
`document_recall_at_k` 使用最终检索结果的前 K 个引用文档计算；K 默认取 `RAG_TOP_K`（默认 5），
可通过 `--retrieval-k <K>` 固定。

每次运行会把 Nest 和评估进度日志写入与报告同名的 `.log` 文件（例如
`evaluation/results/run-….log`），同时继续输出到终端。用
`--log-file evaluation/results/smoke.log` 可指定日志文件位置。

追加 `--judge`（或设置 `EVAL_LLM_JUDGE_ENABLED=true`）会在每个 RAG 案例结束后额外调用一次
LLM Judge。它使用本次实际传给生成器的完整召回上下文，报告 `groundedness`；无答案案例还会用
语义判定覆盖固定短语规则。Judge 失败时运行失败，避免静默漏评。可通过
`EVAL_JUDGE_MAX_CONTEXT_CHARS`（默认 16000）限制发送给 Judge 的资料长度。
可选的 `EVAL_JUDGE_MODEL_NAME` 可指定与生成模型不同的 Judge 模型；未设置时复用主 LLM 模型。

## 数据字段

- `input.question`：本轮问题。
- `input.context`：可选的 `history` 与 `summary`，用于多轮测试。
- `expected.route`：`direct` 或 `rag`。
- `expected.relevantDocumentIds`：应召回的文档；生成 retrieval recall 与 citation precision。
- `expected.relevantChunkIds`：可选的证据块金标；用于后续 chunk 级检索指标。
- `expected.referenceAnswer`：可选的业务金标回复，供人工或 LLM Judge 判断语义正确性与完整性；不得用逐字匹配作为门禁。
- `expected.mustInclude`：答案必须包含的稳定关键事实。不要塞整段标准答案。
- `expected.mustNotInclude`：禁用陈述、泄漏词或错误事实。
- `expected.mustCite`：是否必须返回引用。
- `expected.noAnswer`：该案例是否属于知识库无答案案例。为 `true` 时生成独立的
  `noAnswerRecognition` 检查；默认要求答案包含“根据现有资料无法回答”。
- `expected.noAnswerPhrases`：可选，覆盖无答案识别时允许的固定表述。
- `expected.minGroundedness`：可选，0 到 1。仅在启用 `--judge` 时作为该案例的 groundedness
  门槛；未设置时仍报告分数，但不影响案例通过状态。
- `expected.maxIterations` / `maxTotalMs`：可选资源与时延预算。
- `metadata.split`：`smoke`、`dev` 或 `test`。只在 `dev` 调 prompt，`test` 留作最终验收。

示例文件中的模板项不是有效的业务金标，必须替换后才能作为上线依据。尤其 smoke 中的
RAG、无答案和 prompt injection 模板：替换为真实问题、已发布文档 ID 和业务复核的关键事实后，
才可用于门禁。
