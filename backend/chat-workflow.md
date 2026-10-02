## Agent 整体流程图


analyze（只执行一次）
  ↓
recallMemory
  ↓
  ├─ 无需检索 → directGenerate → END
  │
  └─ 需要检索 → retrieve kb → assessEvidence
                         ↑         │
        需要补检索 或 web  └─────────┤
        (最多3轮)                   │
                                   └→ generateFinal → END



retrieve kb
如果知识不够准确，判断
  rewrite and retrieve：知识部分缺失，针对性捞回
  retrieve kg：按需启用，只有问题属于"关系 / 多跳 / 全局聚合"类型时才走，因为它建库和查询成本最高
  web search：强时效信息
