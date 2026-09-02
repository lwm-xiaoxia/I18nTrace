/**
 * 译文归一化：用于「按译文反查 key」的部分匹配。
 * - 去首尾空白
 * - 连续空白（含换行）压成单个空格
 * - 转小写（大小写不敏感匹配）
 * 注意：这里不删除标点，保证「删除成功！」与「删除成功」可区分但仍可子串命中。
 */
export function normalizeTranslation(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 转义正则元字符，把任意字符串当字面量用。 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 按显示宽度粗略截断（中文按 2、其他按 1 计）。
 * maxLen 指「英文字符数」当量，超出补省略号。
 */
export function truncateForHint(text: string, maxLen: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  // 设置界面的 minimum 只拦 UI，手写 settings.json 仍可能填 0 或负数，
  // 那会让每个气泡都只剩一个省略号。这里兜一个下限。
  const limit = Number.isFinite(maxLen) ? Math.max(4, Math.floor(maxLen)) : 40;
  let width = 0;
  let out = '';
  for (const ch of oneLine) {
    const w = ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
    if (width + w > limit) {
      return out + '…';
    }
    width += w;
    out += ch;
  }
  return out;
}
