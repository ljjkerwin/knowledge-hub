# Agentic RAG Frontend

基于 Next.js 16 的智能知识库问答系统前端。

## 技术栈

- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **组件库**: shadcn/ui
- **状态管理**: Zustand
- **AI SDK**: @ai-sdk/react

## 开始使用

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:3001（自动跳转到 `/chat`）

### 构建生产版本

```bash
pnpm build
```

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面
│   ├── chat/              # 聊天页面
│   ├── layout.tsx         # 根布局
│   └── page.tsx           # 首页（重定向到 /chat）
├── components/
│   ├── layout/            # 布局组件
│   │   ├── main-layout.tsx # 主布局（左右栏）
│   │   └── sidebar.tsx     # 左侧菜单栏
│   ├── chat/              # 聊天相关组件
│   │   ├── chat-input.tsx
│   │   ├── conversation-panel.tsx # 对话历史面板
│   │   ├── message-list.tsx
│   │   ├── message-bubble.tsx
│   │   └── streaming-bubble.tsx
│   └── ui/                # shadcn/ui 组件
├── lib/
│   ├── api-client.ts      # API 客户端
│   └── utils.ts           # 工具函数
├── services/
│   ├── rag.service.ts     # RAG 服务
│   └── conversation.service.ts  # 对话服务
├── stores/
│   └── chat.store.ts      # Zustand 状态管理
└── types/
    ├── api.types.ts       # API 类型定义
    └── agui.types.ts      # AGUI 事件类型
```

## 布局结构

```
┌─────────────────────────────────────────────────┐
│ [☰] Agentic RAG                                │
├──────────┬──────────────────────────────────────┤
│ 💬 问答   │  ┌──────────────────────────────┐   │
│ 📄 管理   │  │     对话历史面板（可折叠）     │   │
│ ⚙️ 设置   │  ├──────────────────────────────┤   │
│          │  │                              │   │
│          │  │       消息列表               │   │
│          │  │                              │   │
│          │  ├──────────────────────────────┤   │
│ v1.0.0   │  │       输入框                 │   │
└──────────┴──┴──────────────────────────────┴───┘
```

## 环境变量

创建 `.env.local` 文件：

```bash
NEXT_PUBLIC_API_URL=http://localhost:5002
```

## 功能特性

- ✅ 左右栏布局（可折叠菜单）
- ✅ 智能问答对话
- ✅ 流式响应（SSE）
- ✅ 对话历史管理
- ✅ 引用来源展示
- ✅ 响应式设计

## 与后端集成

前端默认连接 `http://localhost:5002` 的后端服务。确保后端服务已启动：

```bash
cd ../backend
pnpm start:dev
```
