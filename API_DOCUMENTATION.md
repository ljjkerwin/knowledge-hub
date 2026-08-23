# Knowledge Hub 后端接口文档

## 目录

- [技术栈](#技术栈)
- [基础信息](#基础信息)
- [接口列表](#接口列表)
  - [健康检查](#1-健康检查)
  - [文档管理](#2-文档管理)
  - [文档审核](#3-文档审核)
- [数据模型](#数据模型)
- [状态流转](#状态流转)
- [前端集成指南](#前端集成指南)

---

## 技术栈

| 类别 | 技术 |
|---|---|
| **框架** | NestJS 11 (TypeScript) |
| **主数据库** | PostgreSQL (TypeORM) |
| **文档存储** | MongoDB (Mongoose) |
| **消息队列** | RabbitMQ |
| **搜索引擎** | Elasticsearch |
| **知识图谱** | Neo4j |
| **对象存储** | S3 兼容 (RustFS) |
| **AI/向量** | LangChain + OpenAI |

---

## 基础信息

- **基础路径**: `/`
- **数据格式**: `application/json`（文件上传使用 `multipart/form-data`）
- **ID 类型**: 雪花 ID（字符串格式，如 `"1234567890123456789"`）
- **分页参数**: `page`（从 1 开始）, `pageSize`（1-100，默认 20）
- **时间格式**: ISO 8601（如 `"2024-01-15T10:30:00Z"`）

### 通用响应结构

**成功响应:**
```json
// 单个对象
{ "id": "...", "title": "...", ... }

// 分页列表
{
  "items": [...],
  "total": 100,
  "page": 1,
  "pageSize": 20
}
```

**错误响应:**
```json
{
  "statusCode": 400,
  "message": "错误描述",
  "error": "Bad Request"
}
```

---

## 接口列表

### 1. 健康检查

#### `GET /`

检查服务是否正常运行。

**响应:**
```
Hello World!
```

---

### 2. 文档管理

#### 2.1 创建文档

`POST /documents`

创建新的文档记录。

**请求 Body:**
```json
{
  "title": "文档标题",           // 必填，字符串
  "content": "# Markdown 正文",  // 必填，字符串
  "summary": "摘要",             // 可选，不传自动截取正文前200字
  "categoryId": "1234567890",    // 可选，分类 ID
  "teamId": "1234567890",        // 可选，团队 ID
  "authorId": "1234567890",      // 可选，作者 ID
  "coverImage": "https://...",   // 可选，封面图 URL
  "tags": "标签1,标签2",         // 可选，标签（逗号分隔）
  "status": 0,                   // 可选，0=草稿(默认) / 1=已发布
  "remark": "备注",              // 可选
  "isPublic": true,              // 可选，是否公开（默认 false）
  "createBy": "1234567890"       // 可选，创建人 ID
}
```

**响应:** 文档详情对象（见 [文档详情响应结构](#文档详情响应结构)）

---

#### 2.2 上传文件解析

`POST /documents/upload/parse`

上传文件并自动解析为 Markdown，创建草稿文档。

**请求:** `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | File | ✅ | 文件（最大 50MB） |
| `categoryId` | string | ❌ | 分类 ID |
| `teamId` | string | ❌ | 团队 ID |
| `authorId` | string | ❌ | 作者 ID |
| `tags` | string | ❌ | 标签 |
| `remark` | string | ❌ | 备注 |
| `createBy` | string | ❌ | 创建人 ID |
| `isPublic` | boolean | ❌ | 是否公开 |

**支持的文件格式:**
- PDF (.pdf)
- Word (.docx)
- Excel (.xlsx)
- PowerPoint (.pptx)
- 纯文本 (.txt)

**响应:**
```json
{
  "documentId": "1234567890123456789",
  "title": "文件名.pdf",
  "fileUrl": "https://rustfs.example.com/...",
  "fileSize": 1024000,
  "fileExtension": ".pdf",
  "contentLength": 5000,
  "contentPreview": "正文前200字符...",
  "status": 0
}
```

---

#### 2.3 查询文档列表

`GET /documents`

分页查询文档列表（仅返回元数据，不含正文 content）。

**Query 参数:**

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `title` | string | - | 标题模糊搜索（ILIKE） |
| `categoryId` | string | - | 分类 ID 精确筛选 |
| `teamId` | string | - | 团队 ID 精确筛选 |
| `authorId` | string | - | 作者 ID 精确筛选 |
| `status` | number | - | 状态精确筛选（0/1/2/3） |
| `page` | number | 1 | 页码（从 1 开始） |
| `pageSize` | number | 20 | 每页条数（1-100） |

**请求示例:**
```
GET /documents?status=1&page=1&pageSize=10&title=教程
```

**响应:**
```json
{
  "items": [
    {
      "id": "1234567890123456789",
      "title": "文档标题",
      "contentId": "abc123def456",
      "summary": "摘要内容",
      "categoryId": "111",
      "teamId": "222",
      "authorId": "333",
      "coverImage": "https://...",
      "tags": "标签1,标签2",
      "status": 1,
      "remark": null,
      "viewCount": 100,
      "likeCount": 10,
      "commentCount": 5,
      "favouriteCount": 3,
      "wordCount": 5000,
      "publishTime": "2024-01-15T10:30:00Z",
      "isPublic": true,
      "createdAt": "2024-01-15T08:00:00Z",
      "updatedAt": "2024-01-15T10:30:00Z",
      "createBy": "user123",
      "updateBy": "user123",
      "deleted": false
    }
  ],
  "total": 50,
  "page": 1,
  "pageSize": 20
}
```

---

#### 2.4 查询文档详情

`GET /documents/:id`

获取文档完整信息，包含 Markdown 正文。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档雪花 ID |

**响应:** [文档详情响应结构](#文档详情响应结构)

---

#### 2.5 更新文档

`PATCH /documents/:id`

更新文档信息（所有字段可选）。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档雪花 ID |

**请求 Body:**
```json
{
  "title": "新标题",
  "content": "新正文",
  "summary": "新摘要",
  "categoryId": "新的分类ID",
  "teamId": "新的团队ID",
  "authorId": "新的作者ID",
  "coverImage": "https://...",
  "tags": "新标签1,新标签2",
  "remark": "新备注",
  "isPublic": false,
  "updateBy": "操作人ID"
}
```

**约束:**
- 待审核状态（status=3）禁止修改正文和标题
- 状态字段不可通过此接口修改（使用专用状态流转接口）

**响应:** [文档详情响应结构](#文档详情响应结构)

---

#### 2.6 删除文档

`DELETE /documents/:id`

软删除文档（标记 deleted=true）。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档雪花 ID |

**响应:**
```json
{
  "id": "1234567890123456789",
  "deleted": true
}
```

> ⚠️ 已发布文档删除时会异步清理 ES 搜索索引、向量块与 Neo4j 图谱。

---

#### 2.7 发布文档

`PUT /documents/:id/publish`

发布文档或提交审核。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档雪花 ID |

**行为:**
- **免审模式** (`DOCUMENT_REQUIRE_APPROVAL=false`): 直接发布 + 投递 MQ 建索引
- **需审核模式**: 进入待审核状态 (status=3)

**响应:** 文档详情对象

---

#### 2.8 归档文档

`PUT /documents/:id/archive`

归档已发布的文档。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档雪花 ID |

**约束:** 只有 Published(1) 状态可归档

**行为:** Published → Archived，清理 RAG/Search/KG 索引

**响应:** 文档元数据（不含正文）

---

#### 2.9 下架为草稿

`PUT /documents/:id/save-draft`

将已发布文档下架为草稿状态。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档雪花 ID |

**约束:** 只有 Published(1) 状态可操作

**行为:** Published → Draft，清理索引

**响应:** 文档元数据（不含正文）

---

### 3. 文档审核

#### 3.1 提交审核

`POST /documents/:id/reviews/submit`

提交文档进入审核流程。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档雪花 ID |

**约束:**
- 只有 Draft(0) 或 Published(1) 状态可提交
- 同一文档同时只能有一条待审记录

**行为:** 创建审核记录 → 文档状态变 PendingReview(3)

**响应:** 文档详情对象

---

#### 3.2 获取当前待审记录

`GET /documents/:id/reviews/current`

获取文档当前的待审核记录。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档雪花 ID |

**响应:**
```json
{
  "id": "审核记录ID",
  "documentId": "文档ID",
  "reviewerId": null,
  "reviewerName": null,
  "reviewResult": null,
  "reviewComment": null,
  "beforeStatus": 0,
  "reviewedAt": null,
  "createdAt": "2024-01-15T10:00:00Z"
}
```

如果无待审记录，返回 `null`。

---

#### 3.3 获取审核历史

`GET /documents/:id/reviews/history`

获取文档的全部审核历史记录。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档雪花 ID |

**响应:** 审核记录数组（按创建时间倒序）

---

#### 3.4 审核任务列表

`GET /documents/reviews/tasks`

获取审核任务列表（审核员工作台）。

**Query 参数:**

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `status` | string | `'pending'` | 筛选：`pending` 待办 / `approved` 已通过 / `rejected` 已驳回 |
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页条数（1-100） |

**响应:**
```json
{
  "items": [
    {
      "id": "审核记录ID",
      "documentId": "文档ID",
      "reviewerId": null,
      "reviewerName": null,
      "reviewResult": null,
      "reviewComment": null,
      "beforeStatus": 0,
      "reviewedAt": null,
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 10,
  "page": 1,
  "pageSize": 20
}
```

---

#### 3.5 待审核数量

`GET /documents/reviews/tasks/pending-count`

获取待审核任务数量（用于导航角标）。

**响应:**
```json
5
```

---

#### 3.6 审核通过

`POST /documents/reviews/tasks/:taskId/approve`

审核通过文档。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `taskId` | string | 审核记录雪花 ID |

**请求 Body:**
```json
{
  "reviewComment": "审核意见",    // 可选
  "reviewerId": "审核人ID",      // 可选
  "reviewerName": "审核人姓名"    // 可选
}
```

**行为:** 审核通过 → 文档 Published + 重建索引

**响应:** 文档详情对象

---

#### 3.7 审核驳回

`POST /documents/reviews/tasks/:taskId/reject`

驳回文档审核。

**路径参数:**
| 参数 | 类型 | 说明 |
|---|---|---|
| `taskId` | string | 审核记录雪花 ID |

**请求 Body:**
```json
{
  "reviewComment": "驳回原因",    // 必填
  "reviewerId": "审核人ID",      // 可选
  "reviewerName": "审核人姓名"    // 可选
}
```

**行为:** 审核驳回 → 文档回 Draft

**响应:** 文档详情对象

---

## 数据模型

### 文档详情响应结构

```json
{
  "id": "1234567890123456789",      // 雪花 ID
  "title": "文档标题",
  "contentId": "abc123def456",      // MongoDB ObjectId
  "summary": "摘要",
  "categoryId": "111",
  "teamId": "222",
  "authorId": "333",
  "coverImage": "https://...",
  "tags": "标签1,标签2",
  "status": 1,                      // 0=草稿, 1=已发布, 2=已归档, 3=待审核
  "remark": null,
  "viewCount": 100,
  "likeCount": 10,
  "commentCount": 5,
  "favouriteCount": 3,
  "wordCount": 5000,
  "publishTime": "2024-01-15T10:30:00Z",
  "isPublic": true,
  "createdAt": "2024-01-15T08:00:00Z",
  "updatedAt": "2024-01-15T10:30:00Z",
  "createBy": "user123",
  "updateBy": "user123",
  "deleted": false,
  "content": "# Markdown 正文内容..."   // 仅详情接口返回
}
```

### 文档状态枚举

| 值 | 状态 | 说明 |
|---|---|---|
| `0` | Draft | 草稿 |
| `1` | Published | 已发布 |
| `2` | Archived | 已归档 |
| `3` | PendingReview | 待审核 |

### 审核结果枚举

| 值 | 结果 |
|---|---|
| `null` | 待审核 |
| `1` | 通过 |
| `2` | 驳回 |

### 审核记录结构

```json
{
  "id": "审核记录雪花ID",
  "documentId": "文档ID",
  "reviewerId": "审核人ID",
  "reviewerName": "审核人姓名",
  "reviewResult": null,          // null=待审, 1=通过, 2=驳回
  "reviewComment": "审核意见",
  "beforeStatus": 0,             // 提审前文档状态
  "reviewedAt": null,            // 审核完成时间
  "createdAt": "2024-01-15T10:00:00Z"
}
```

---

## 状态流转

```
                    ┌──────────────────────────────────────┐
                    │                                      │
                    ▼                                      │
┌───────┐  publish   ┌───────────┐  archive   ┌──────────┐ │
│ Draft ├───────────►│ Published ├───────────►│ Archived │ │
│  (0)  │            │    (1)    │            │   (2)    │ │
└───┬───┘            └─────┬─────┘            └──────────┘ │
    │                      │                               │
    │ submit review        │ save-draft                    │
    │                      │                               │
    ▼                      ▼                               │
┌───────────────┐    ┌───────┐                             │
│ PendingReview │    │ Draft │                             │
│     (3)       ├───►│  (0)  │                             │
└───────┬───────┘     └───────┘                             │
        │                                                   │
        │ approve                                           │
        └───────────────────────────────────────────────────┘
```

**审核模式:**
- 环境变量 `DOCUMENT_REQUIRE_APPROVAL` 控制是否需要审核（默认 `true`）
- 免审模式下，publish 直接进入 Published 状态
- 需审核模式下，publish 进入 PendingReview 状态

---

## 前端集成指南

### 1. 文档列表页面

**核心接口:**
- `GET /documents` - 获取分页列表

**实现要点:**
```typescript
// 获取文档列表
const fetchDocuments = async (params: {
  page?: number;
  pageSize?: number;
  title?: string;
  status?: number;
  categoryId?: string;
}) => {
  const query = new URLSearchParams(params as any).toString();
  const res = await fetch(`/documents?${query}`);
  return res.json(); // { items, total, page, pageSize }
};
```

**UI 建议:**
- 使用表格或卡片展示列表
- 支持标题搜索、状态筛选、分类筛选
- 列表项显示：标题、摘要、状态标签、浏览数、创建时间
- 分页组件

---

### 2. 文档编辑页面

**核心接口:**
- `POST /documents` - 创建新文档
- `PATCH /documents/:id` - 保存草稿
- `PUT /documents/:id/publish` - 发布文档

**实现要点:**
```typescript
// 创建文档
const createDocument = async (data: CreateDocumentDto) => {
  const res = await fetch('/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
};

// 保存草稿
const saveDraft = async (id: string, data: UpdateDocumentDto) => {
  const res = await fetch(`/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
};

// 发布文档
const publishDocument = async (id: string) => {
  const res = await fetch(`/documents/${id}/publish`, {
    method: 'PUT',
  });
  return res.json();
};
```

**UI 建议:**
- 使用 Markdown 编辑器（如 `@uiw/react-md-editor`、`vditor`）
- 自动保存草稿功能（防抖 3 秒）
- 发布前确认弹窗
- 显示当前文档状态

---

### 3. 文件上传功能

**核心接口:**
- `POST /documents/upload/parse` - 上传并解析文件

**实现要点:**
```typescript
// 上传文件
const uploadFile = async (file: File, metadata?: {
  categoryId?: string;
  teamId?: string;
  tags?: string;
}) => {
  const formData = new FormData();
  formData.append('file', file);
  if (metadata?.categoryId) formData.append('categoryId', metadata.categoryId);
  if (metadata?.teamId) formData.append('teamId', metadata.teamId);
  if (metadata?.tags) formData.append('tags', metadata.tags);

  const res = await fetch('/documents/upload/parse', {
    method: 'POST',
    body: formData,
  });
  return res.json();
};
```

**UI 建议:**
- 拖拽上传区域
- 文件类型限制：.pdf, .docx, .xlsx, .pptx, .txt
- 文件大小限制：50MB
- 上传进度条
- 解析完成后跳转到编辑页面

---

### 4. 审核工作台

**核心接口:**
- `GET /documents/reviews/tasks?status=pending` - 待办列表
- `GET /documents/reviews/tasks/pending-count` - 待审核数量
- `POST /documents/reviews/tasks/:taskId/approve` - 审核通过
- `POST /documents/reviews/tasks/:taskId/reject` - 审核驳回

**实现要点:**
```typescript
// 获取待审核数量（用于角标）
const fetchPendingCount = async (): Promise<number> => {
  const res = await fetch('/documents/reviews/tasks/pending-count');
  return res.json();
};

// 审核通过
const approveTask = async (taskId: string, comment?: string) => {
  const res = await fetch(`/documents/reviews/tasks/${taskId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewComment: comment }),
  });
  return res.json();
};

// 审核驳回
const rejectTask = async (taskId: string, comment: string) => {
  const res = await fetch(`/documents/reviews/tasks/${taskId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewComment: comment }),
  });
  return res.json();
};
```

**UI 建议:**
- 待办/已办 Tab 切换
- 审核卡片展示：文档标题、提交时间、提交人
- 审核弹窗：预览文档内容、填写审核意见
- 驳回时意见必填

---

### 5. 文档详情页面

**核心接口:**
- `GET /documents/:id` - 获取完整内容
- `GET /documents/:id/reviews/history` - 审核历史
- `GET /documents/:id/reviews/current` - 当前待审记录

**实现要点:**
```typescript
// 获取文档详情
const fetchDocument = async (id: string) => {
  const res = await fetch(`/documents/${id}`);
  return res.json();
};

// 获取审核历史
const fetchReviewHistory = async (id: string) => {
  const res = await fetch(`/documents/${id}/reviews/history`);
  return res.json();
};
```

**UI 建议:**
- Markdown 渲染（如 `react-markdown`）
- 状态标签显示
- 操作按钮根据状态动态显示：
  - Draft: 编辑、发布、删除
  - Published: 下架、归档、提交审核
  - PendingReview: 查看审核进度
  - Archived: 重新发布
- 审核历史时间线

---

## 快速参考

### 接口速查表

| 功能 | 方法 | 路径 |
|---|---|---|
| 创建文档 | POST | `/documents` |
| 上传文件 | POST | `/documents/upload/parse` |
| 文档列表 | GET | `/documents` |
| 文档详情 | GET | `/documents/:id` |
| 更新文档 | PATCH | `/documents/:id` |
| 删除文档 | DELETE | `/documents/:id` |
| 发布文档 | PUT | `/documents/:id/publish` |
| 归档文档 | PUT | `/documents/:id/archive` |
| 下架草稿 | PUT | `/documents/:id/save-draft` |
| 提交审核 | POST | `/documents/:id/reviews/submit` |
| 当前待审 | GET | `/documents/:id/reviews/current` |
| 审核历史 | GET | `/documents/:id/reviews/history` |
| 审核任务 | GET | `/documents/reviews/tasks` |
| 待审数量 | GET | `/documents/reviews/tasks/pending-count` |
| 审核通过 | POST | `/documents/reviews/tasks/:taskId/approve` |
| 审核驳回 | POST | `/documents/reviews/tasks/:taskId/reject` |

---

*文档版本: 1.0.0*
*最后更新: 2024-01-15*
