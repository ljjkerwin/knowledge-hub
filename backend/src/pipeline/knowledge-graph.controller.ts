import { Controller, Get, Param, Query } from '@nestjs/common';
import { GraphBuildService } from './graph-build.service';

/** 面向前端的知识图谱只读接口。 */
@Controller('knowledge-graph')
export class KnowledgeGraphController {
  constructor(private readonly graphBuildService: GraphBuildService) {}

  /** 在图谱的文档、分块与实体节点属性中搜索。 */
  @Get('search')
  search(@Query('keyword') keyword?: string, @Query('limit') limit?: string) {
    return this.graphBuildService.searchNodes(
      keyword?.trim() ?? '',
      Number(limit) || 20,
    );
  }

  /** 单篇文档的实体子图；使用独立路径，避免与全局图谱混淆。 */
  @Get('documents/:documentId')
  getDocumentVisualization(
    @Param('documentId') documentId: string,
    @Query('limit') limit?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.graphBuildService.getVisualization(
      Number(limit) || 60,
      documentId.trim(),
      keyword?.trim() || undefined,
    );
  }

  @Get()
  getVisualization(
    @Query('limit') limit?: string,
    @Query('documentId') documentId?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.graphBuildService.getVisualization(
      Number(limit) || 60,
      documentId?.trim() || undefined,
      keyword?.trim() || undefined,
    );
  }
}
