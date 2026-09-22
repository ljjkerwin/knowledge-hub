import { Injectable } from '@nestjs/common';

export interface AboutInfo {
  title: string;
  description: string;
  highlights: string[];
}

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getAbout(): AboutInfo {
    return {
      title: '关于 Agentic RAG',
      description:
        'Agentic RAG 是面向团队的智能知识库，帮助你沉淀资料、建立关联，并快速获得可信的答案。',
      highlights: [
        '集中管理团队文档，让知识持续积累。',
        '结合智能检索与问答，快速定位所需信息。',
        '通过知识图谱发现内容之间的关联。',
      ],
    };
  }
}
