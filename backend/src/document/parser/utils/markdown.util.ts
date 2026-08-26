/**
 * 部分 PDF 的字体子集会把常用汉字提取为 CJK 部首兼容字形（如「⻓」）。
 * 这些字形肉眼可读，但不会和用户查询或已有索引中的「长」匹配，因而会降低
 * 关键词检索、向量检索及评估中的文本命中率。
 */
const PDF_COMPATIBILITY_GLYPHS: Record<string, string> = {
  '⻅': '见',
  '⻆': '角',
  '⻋': '车',
  '⻓': '长',
  '⻔': '门',
  '⻛': '风',
  '⻜': '飞',
};

/**
 * 在入库前统一 Unicode 兼容形式，并修正 PDF 文本提取器遗留的部首字形。
 * 该函数应只用于提取后的纯文本，不处理文件名或原始二进制内容。
 */
export function normalizeExtractedText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[⻅⻆⻋⻓⻔⻛⻜]/g, (glyph) => PDF_COMPATIBILITY_GLYPHS[glyph]);
}

/** 规范化 Markdown：统一字形与换行，压缩连续空行，去首尾空白 */
export function cleanMarkdown(text: string): string {
  if (!text) return '';
  return normalizeExtractedText(text)
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** 转义表格单元格中的 `|`，并把换行压成空格，避免破坏表结构 */
export function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/**
 * 二维数组 → Markdown 表格（首行作表头，第二行输出 `| --- |` 分隔）。
 * 列数按所有行的最大列对齐，缺省单元格视为空串。
 */
export function toMarkdownTable(rows: string[][]): string {
  if (!rows.length) return '';

  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (maxCols === 0) return '';

  const lines: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const cells: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      cells.push(escapeTableCell(rows[r][c] ?? ''));
    }
    lines.push(`| ${cells.join(' | ')} |`);
    if (r === 0) {
      lines.push(`| ${Array(maxCols).fill('---').join(' | ')} |`);
    }
  }
  return `${lines.join('\n')}\n\n`;
}

/** 取文件扩展名（小写，不含点）；无扩展名时返回空串 */
export function getExtension(filename?: string | null): string {
  if (!filename || !filename.includes('.')) return '';
  return filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
}

/**
 * Multer/busboy 常把 multipart 文件名的 UTF-8 字节按 Latin-1 解码，
 * 导致中文变成「ç³è®º…」。按 Latin-1 取回原始字节再按 UTF-8 还原。
 */
export function decodeUploadFilename(filename?: string | null): string {
  if (!filename) return '';
  try {
    const decoded = Buffer.from(filename, 'latin1').toString('utf8');
    // 解码失败会出现替换字符，此时保留原值
    if (decoded.includes('\uFFFD')) return filename;
    return decoded;
  } catch {
    return filename;
  }
}

/** 去掉扩展名作为文档标题；空文件名时返回「未命名文档」 */
export function titleFromFilename(filename?: string | null): string {
  if (!filename) return '未命名文档';
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
