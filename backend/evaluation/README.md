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

## 用 Ragas 从本地文件生成数据集

`generate_ragas_dataset.py` 是一个独立的 Python 脚本，用于把本地 Markdown/
文本文件合成为 Ragas 测试集；它不会安装 Python 依赖到 Node.js 项目中。先创建虚拟环境：

```bash
cd backend
python3 -m venv .venv-ragas
source .venv-ragas/bin/activate
pip install -r evaluation/requirements-ragas.txt
```

当前请使用该 requirements 文件中的固定依赖组合。`ragas==0.4.3` 与新版
`langchain-community` 存在上游导入缺陷，会在加载 Ragas 前报
`chat_models.vertexai` 找不到；不要单独升级 Ragas 或 LangChain 包。

脚本会自动读取 `backend/.env`。至少配置生成模型的 `OPENAI_API_KEY`；以下变量将
让生成 LLM 与 Embedding 模型完全分开：

```dotenv
OPENAI_BASE_URL=https://llm.example.com/v1
OPENAI_MODEL_NAME=gpt-4.1-mini
OPENAI_API_KEY=...

EMBEDDING_BASE_URL=https://embedding.example.com/v1
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
```

本地 OpenAI 兼容的 BGE Embedding 服务（例如 `BAAI/bge-m3`）通常只接受文本
字符串作为 `/embeddings` 的 `input`。脚本已禁用 LangChain 默认的 token-ID
预分词，避免这类服务返回 HTTP 422；请确保单个源文件/文本块不超过你的 Embedding
服务允许的输入长度。

以下命令会产生两份数据：第一份保留 `user_input`、`reference` 与
`reference_contexts`，用于 Ragas 的 `answer_relevancy`、`faithfulness`、
`context_recall`、`context_precision`；第二份适配本仓库的 Node 评估运行器：

```bash
python evaluation/generate_ragas_dataset.py \
  --input ../test-files/parenting-ecommerce \
  --size 30 \
  --output evaluation/generated/parenting-ragas.jsonl \
  --runner-output evaluation/generated/parenting-runner.jsonl

pnpm eval:validate evaluation/generated/parenting-runner.jsonl
```

LLM 与 Embedding 可单独选模型、OpenAI 兼容地址及密钥。上面的 `.env` 会让
生成问题/答案使用一个模型服务，让知识图谱向量化使用另一个服务。若要临时覆盖 `.env`，
仍可传命令行参数：

```bash
python evaluation/generate_ragas_dataset.py \
  --input ../test-files/parenting-ecommerce \
  --size 30 \
  --output evaluation/generated/parenting-ragas.jsonl \
  --model gpt-4.1-mini \
  --llm-base-url https://llm.example.com/v1 \
  --embedding-model text-embedding-3-small \
  --embedding-base-url https://embedding.example.com/v1
```

未传这些参数时，分别使用上列 `.env` 的值；当未设置 `EMBEDDING_API_KEY` 时，
Embedding 默认复用 `OPENAI_API_KEY`。

脚本目前递归支持 `.md`、`.markdown` 与 `.txt`。生成内容应先经业务人工审核，
再作为 `test` 集使用；合成集适合补齐覆盖面，不能替代真实用户问题。

## Upload a dataset to Langfuse

Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and (when not using the EU
cloud endpoint) `LANGFUSE_BASE_URL` in `.env`, then upload the source cases:

```bash
pnpm eval:dataset:upload -- --dataset evaluation/dataset.smoke.jsonl --langfuse-dataset rag-smoke
```

The command creates the Langfuse dataset when necessary and upserts each case
using a stable ID. Its `input` becomes the Langfuse dataset input, the complete
`expected` object becomes `expectedOutput`, and the case ID is kept in metadata.
Use `--dry-run` to validate the JSONL and inspect the target without calling
Langfuse.

## Run a Langfuse Dataset experiment

After uploading a dataset, run the same Agent and deterministic checks against
the hosted cases. Langfuse records one trace and the individual checks as scores
for every case, plus average scores on the Dataset Run.

```bash
pnpm eval:dataset:langfuse -- \
  --langfuse-dataset rag-smoke \
  --split smoke \
  --run-name local-smoke
```

`--case <sourceCaseId>`, `--retrieval-k <number>`, `--judge`, and
`--max-concurrency <number>` are also supported. The default concurrency is 1
to avoid distorting local-model and Elasticsearch measurements.

runner 使用独立的 `EvaluationModule`，不会连接 HTTP、Postgres、MongoDB、消息队列或
对象存储。报告写入 `evaluation/results/`。`--gate` 接受 0 到 1 的最低案例通过率，低于门槛时
进程以状态码 2 退出。

`--case <id>` 只运行指定 case；`--case-index <n>` 按数据集中的第 `n` 条 case 运行（从 1 开始）。
与 `--split` 组合时，序号在该 split 的筛选结果中计算；两者不可同时使用。

`summary.metrics` 只保留蛇形命名的核心指标：`request_success_rate`、`route_accuracy`、
`document_recall_at_k`、`required_fact_recall`、`groundedness`、`answer_relevancy`、`no_answer_accuracy` 和
`time_to_first_text_ms`。各条件指标的样本量在 `summary.metric_samples` 中；没有无答案样本时
`no_answer_accuracy` 为 `null`。引用精度、禁用内容等附加检查放在 `summary.diagnostics`。
`document_recall_at_k` 使用最终检索结果的前 K 个引用文档计算；K 默认取 `RAG_TOP_K`（默认 5），
可通过 `--retrieval-k <K>` 固定。

每次运行会把 Nest 和评估进度日志写入与报告同名的 `.log` 文件（例如
`evaluation/results/run-….log`），同时继续输出到终端。用
`--log-file evaluation/results/smoke.log` 可指定日志文件位置。

追加 `--judge`（或设置 `EVAL_LLM_JUDGE_ENABLED=true`）会在每个评测案例结束后额外调用一次
LLM Judge。它对每个案例报告 `answer_relevancy`，并使用本次实际传给生成器的完整召回上下文报告
`groundedness`；无答案案例还会用语义判定覆盖固定短语规则。数据集可用
`expected.minAnswerRelevancy`（0 到 1）将答案相关性设为案例门禁。Judge 失败时运行失败，避免静默漏评。可通过
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
