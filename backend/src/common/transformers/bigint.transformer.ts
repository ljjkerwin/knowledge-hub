import { ValueTransformer } from 'typeorm';

/**
 * Postgres BIGINT ↔ JS string
 * 雪花 ID 超过 Number 安全整数范围，必须用字符串，否则会丢精度。
 * 
 * JavaScript 中能精确表示的最大安全整数是 $2^{53} - 1$，即 9007199254740991（约 9007 万亿/9 PB）。
 * 雪花 ID 通常是 64 位长整型（最大值 2^{63} - 1 \approx 9.22 \times 10^{18}$）
 */
export const bigintTransformer: ValueTransformer = {
  to: (v) => v, // 写入：原样交给驱动
  from: (v) => (v == null ? v : String(v)), // 读出：统一转成 string
};
