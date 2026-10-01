import { WebSearchService } from './web-search.service';

describe('WebSearchService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps Bocha web pages into web evidence chunks', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: [
                {
                  name: '最新监管规则',
                  url: 'https://example.com/rule',
                  snippet: '简短摘要',
                  summary: '完整网页摘要',
                  siteName: '监管机构',
                  datePublished: '2026-09-30T08:00:00+08:00',
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const service = createService('bocha-test-key');

    const result = await service.search('最新监管规则');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.bocha.cn/v1/web-search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer bocha-test-key',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        documentTitle: '最新监管规则',
        content: '完整网页摘要',
        sourceType: 'web',
        sourceUrl: 'https://example.com/rule',
        metadata: {
          siteName: '监管机构',
          publishTime: '2026-09-30T08:00:00+08:00',
        },
      }),
    );
  });

  it('returns no results without BOCHA_API_KEY', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = createService(undefined);

    await expect(service.search('任意查询')).resolves.toEqual([]);
    expect(service.isConfigured()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function createService(apiKey: string | undefined): WebSearchService {
  return new WebSearchService({
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'BOCHA_API_KEY') return apiKey;
      return fallback;
    }),
  } as never);
}
