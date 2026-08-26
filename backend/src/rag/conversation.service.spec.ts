import { EntityManager } from 'typeorm';
import { ConversationService } from './conversation.service';

describe('ConversationService', () => {
  const entityManager = {
    create: jest.fn((_entity, value) => value),
    save: jest.fn(async (value) => value),
  };

  beforeEach(() => jest.clearAllMocks());

  it('shares one Snowflake generator so concurrent conversations have unique IDs', async () => {
    const service = new ConversationService(entityManager as unknown as EntityManager);

    const conversations = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        service.create('10001', `evaluation-${index}`),
      ),
    );
    const ids = conversations.map((conversation) => conversation.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses the same generator for messages and standalone ID generation', () => {
    const service = new ConversationService(entityManager as unknown as EntityManager);
    const ids = Array.from({ length: 50 }, () => service.generateId());

    expect(new Set(ids).size).toBe(ids.length);
  });
});
