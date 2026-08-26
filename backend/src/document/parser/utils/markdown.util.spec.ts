import { cleanMarkdown, normalizeExtractedText } from './markdown.util';

describe('markdown text normalization', () => {
  it('normalizes compatibility glyphs emitted by PDF text extraction', () => {
    expect(normalizeExtractedText('最⻓补报周期，⻔票与⻜机。')).toBe(
      '最长补报周期,门票与飞机。',
    );
  });

  it('applies text normalization before cleaning markdown whitespace', () => {
    expect(cleanMarkdown('\r\n  部⻔审批\r\n\r\n\r\n\r\n')).toBe('部门审批');
  });
});
