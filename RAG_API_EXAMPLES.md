# RAG API 测试示例

## 1. 基础单轮问答

```bash
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "什么是知识图谱？",
    "searchType": "hybrid",
    "topK": 5
  }'
```

## 2. 流式问答（SSE）

```bash
curl -X POST http://localhost:3000/rag/query/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "question": "知识图谱有哪些应用场景？",
    "searchType": "hybrid",
    "topK": 5
  }'
```

## 3. Agentic RAG 问答

```bash
curl -X POST http://localhost:3000/rag/agent \
  -H "Content-Type: application/json" \
  -d '{
    "question": "如何优化 Elasticsearch 查询性能？",
    "maxIterations": 3,
    "enableFollowUp": true
  }'
```

## 4. 带分类筛选的查询

```bash
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "如何使用向量检索？",
    "searchType": "vector",
    "topK": 3,
    "categoryId": "123456"
  }'
```

## 5. 纯关键词检索

```bash
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Elasticsearch 索引",
    "searchType": "keyword",
    "topK": 10
  }'
```

## 响应格式

### 单轮问答响应
```json
{
  "answer": "知识图谱是一种结构化的知识表示方式...[1]",
  "citations": [
    {
      "index": 1,
      "documentId": "123456",
      "documentTitle": "知识图谱入门指南",
      "chunkContent": "知识图谱（Knowledge Graph）是...",
      "heading": "第一章 什么是知识图谱",
      "similarity": 0.92
    }
  ],
  "confidence": 0.85,
  "queryId": "query_abc123"
}
```

### Agentic RAG 响应
```json
{
  "answer": "优化 Elasticsearch 查询性能可以从以下几个方面入手...",
  "citations": [...],
  "confidence": 0.92,
  "queryId": "agent_abc123",
  "iterations": 2,
  "reasoning": [
    {"step": "iteration_1_analysis", "result": "意图: procedural, 改写: ..."},
    {"step": "iteration_1_strategy", "result": "检索方式: hybrid, topK: 7"},
    {"step": "iteration_1_retrieval", "result": "检索到 8 个相关片段"},
    {"step": "iteration_1_evaluation", "result": "相关性: 0.85, 完整性: 0.7"}
  ]
}
```

## 环境变量配置

确保在 `.env` 文件中配置以下变量：

```bash
# LLM 配置
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL_NAME=deepseek-chat

# Elasticsearch 配置
ELASTICSEARCH_NODE=http://localhost:9200
ELASTICSEARCH_PASSWORD=your-password

# RAG 配置（可选）
RAG_TOP_K=5
RAG_SIMILARITY_THRESHOLD=0.7
RAG_HYBRID_ALPHA=0.7
RAG_MAX_ITERATIONS=3
```
