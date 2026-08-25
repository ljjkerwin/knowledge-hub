import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentReviewService } from './document-review.service';

describe('DocumentController', () => {
  const documentService = {
    create: jest.fn(),
    uploadAndCreateDocument: jest.fn(),
  };
  const reviewService = {};
  const controller = new DocumentController(
    documentService as unknown as DocumentService,
    reviewService as DocumentReviewService,
  );
  const request = { user: { id: 'user-123', role: 0 } };

  beforeEach(() => jest.clearAllMocks());

  it('uses the authenticated user as owner when creating a document', async () => {
    const dto = {
      title: 'Owned document',
      content: 'content',
      authorId: 'spoofed-user',
      createBy: 'spoofed-user',
    };

    await controller.create(dto, request);

    expect(documentService.create).toHaveBeenCalledWith(dto, 'user-123');
  });

  it('uses the authenticated user as owner when uploading a document', async () => {
    const file = { buffer: Buffer.from('content') } as Express.Multer.File;
    const metadata = { authorId: 'spoofed-user', createBy: 'spoofed-user' };

    await controller.uploadAndParse(file, metadata, request);

    expect(documentService.uploadAndCreateDocument).toHaveBeenCalledWith(
      file,
      metadata,
      'user-123',
    );
  });
});
