import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GraphBuildService } from './graph-build.service';

/** 面向前端的知识图谱只读接口。 */
@Controller('knowledge-graph')
@UseGuards(JwtAuthGuard)
export class KnowledgeGraphController {
  constructor(private readonly graphBuildService: GraphBuildService) {}

  /** 单篇文档的实体子图；使用独立路径，避免与全局图谱混淆。 */
  @Get('documents/:documentId')
  getDocumentVisualization(
    @Param('documentId') documentId: string,
    @Query('limit') limit?: string,
  ) {
    return this.graphBuildService.getVisualization(
      Number(limit) || 60,
      documentId.trim(),
    );
  }

  @Get()
  getVisualization(
    @Query('limit') limit?: string,
    @Query('documentId') documentId?: string,
  ) {
    return this.graphBuildService.getVisualization(
      Number(limit) || 60,
      documentId?.trim() || undefined,
    );
  }
}
