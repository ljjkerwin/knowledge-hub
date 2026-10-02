import { LongTermMemoryService } from './long-term-memory.service';

describe('LongTermMemoryService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('only recalls memories above the configured relevance threshold', async () => {
    const { service } = createService({ MEM0_MIN_RECALL_SCORE: 0.5 });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        results: [
          { memory: '用户来自广东省', score: 0.82 },
          { memory: '用户问过广州天气', score: 0.21 },
          { memory: '缺少相关度的旧格式记忆' },
        ],
      }),
    }) as never;

    await expect(service.recall('user-1', '我来自哪里？')).resolves.toEqual([
      '用户来自广东省',
      '缺少相关度的旧格式记忆',
    ]);
  });

  it('uses 0.15 as the default relevance threshold', async () => {
    const { service } = createService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        results: [
          { memory: 'User is from Guangdong province', score: 0.1729 },
          { memory: '低相关度记忆', score: 0.1499 },
        ],
      }),
    }) as never;

    await expect(service.recall('user-1', '我是哪里人？')).resolves.toEqual([
      'User is from Guangdong province',
    ]);
  });

  it('writes only extracted durable user facts instead of the original message', async () => {
    const { service, invoke } = createService();
    invoke.mockResolvedValue({
      memories: ['用户长期居住在广东省', '用户偏好简洁的回答'],
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });
    global.fetch = fetchMock as never;

    await service.remember(
      'user-1',
      'conversation-1',
      '我长期住在广东，回答尽量简洁。广州今天天气如何？',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    if (typeof request.body !== 'string') throw new Error('缺少请求体');
    const body = JSON.parse(request.body) as {
      messages: Array<{ role: string; content: string }>;
      metadata: Record<string, string>;
    };
    expect(body.messages).toEqual([
      { role: 'user', content: '用户长期居住在广东省' },
      { role: 'user', content: '用户偏好简洁的回答' },
    ]);
    expect(
      body.messages.some((message) => message.content.includes('天气')),
    ).toBe(false);
    expect(body.metadata.memory_policy).toBe('durable-user-facts-v1');
  });

  it('skips writes when the extractor finds no durable user facts', async () => {
    const { service, invoke } = createService();
    invoke.mockResolvedValue({ memories: [] });
    global.fetch = jest.fn() as never;

    await service.remember('user-1', 'conversation-1', '广州今天天气如何？');

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips both extraction and persistence for simple chitchat', async () => {
    const { service, invoke } = createService();
    global.fetch = jest.fn() as never;

    await service.remember('user-1', 'conversation-1', '你好');

    expect(invoke).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

function createService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    MEM0_API_KEY: 'test-key',
    ...overrides,
  };
  const invoke = jest.fn().mockResolvedValue({ memories: [] });
  const service = new LongTermMemoryService(
    {
      get: jest.fn((key: string, fallback?: unknown) =>
        key in values ? values[key] : fallback,
      ),
    } as never,
    {
      create: jest.fn(() => ({
        withStructuredOutput: jest.fn(() => ({ invoke })),
      })),
    } as never,
  );
  return { service, invoke };
}
