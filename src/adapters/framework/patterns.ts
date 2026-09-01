import { escapeRegExp } from '../../util/text';

/** 文本层面提取出的一处 key（偏移量相对传入文本）。 */
export interface RawCall {
  key: string;
  /** 命名空间（能从调用点直接读出时） */
  namespace?: string;
  /** key 字符串字面量（含引号）在 text 中的起止 offset */
  keyStart: number;
  keyEnd: number;
  /** Inlay Hint 锚点 offset */
  hintOffset: number;
}

/**
 * 把注释内容替换成等长空格，保持所有 offset 不变。
 *
 * 目的：避免给注释掉的 `t('x')` 也挂译文气泡。必须做成带状态的扫描而不是正则，
 * 因为要正确跳过字符串内容（`'http://x'` 里的 `//` 不是注释），
 * 同时又要能进入模板串的 `${}` 内部（`` `${t('a.b')} 后缀` `` 是真实调用）。
 */
export function maskComments(text: string): string {
  const out = text.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n' && out[i] !== '\r') {
        out[i] = ' ';
      }
    }
  };

  // 模式栈：进入模板串的 ${} 时压入代码模式，出来再弹回模板串
  type Mode = { kind: 'code'; braceDepth: number } | { kind: 'template' } | { kind: 'string'; quote: string };
  const stack: Mode[] = [{ kind: 'code', braceDepth: 0 }];
  const top = (): Mode => stack[stack.length - 1];

  let i = 0;
  while (i < text.length) {
    const mode = top();
    const ch = text[i];

    if (mode.kind === 'string') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === mode.quote || ch === '\n') {
        stack.pop();
      }
      i++;
      continue;
    }

    if (mode.kind === 'template') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        stack.pop();
        i++;
        continue;
      }
      if (ch === '$' && text[i + 1] === '{') {
        stack.push({ kind: 'code', braceDepth: 1 });
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // code 模式
    if (ch === '/' && text[i + 1] === '/') {
      let end = text.indexOf('\n', i);
      if (end === -1) {
        end = text.length;
      }
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      let end = text.indexOf('*/', i + 2);
      end = end === -1 ? text.length : end + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '<' && text.startsWith('<!--', i)) {
      let end = text.indexOf('-->', i + 4);
      end = end === -1 ? text.length : end + 3;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      stack.push({ kind: 'string', quote: ch });
      i++;
      continue;
    }
    if (ch === '`') {
      stack.push({ kind: 'template' });
      i++;
      continue;
    }
    if (ch === '{') {
      mode.braceDepth++;
      i++;
      continue;
    }
    if (ch === '}') {
      mode.braceDepth--;
      // 模板串插值结束：弹回模板串模式
      if (mode.braceDepth === 0 && stack.length > 1) {
        stack.pop();
      }
      i++;
      continue;
    }
    i++;
  }

  return out.join('');
}

/**
 * 文件级默认命名空间。
 *   useTranslation('common')      / useTranslation(['common', 'home'])
 *   withTranslation('common')
 *   getFixedT(null, 'common')
 * 取第一个出现的；取不到返回 undefined。
 */
export function extractDefaultNamespace(text: string): string | undefined {
  const single = /\b(?:useTranslation|withTranslation|getFixedT)\s*\(\s*(?:null\s*,\s*)?['"]([^'"\s]+)['"]/.exec(
    text,
  );
  if (single) {
    return single[1];
  }
  const arr = /\b(?:useTranslation|withTranslation)\s*\(\s*\[\s*['"]([^'"\s]+)['"]/.exec(text);
  return arr ? arr[1] : undefined;
}

/** 从翻译函数的第二个实参里读命名空间：`t('save', { ns: 'common' })`。 */
export function namespaceFromOptions(text: string, fromIndex: number, toIndex: number): string | undefined {
  const slice = text.slice(fromIndex, Math.min(toIndex, fromIndex + 300));
  const m = /\bns\s*:\s*['"]([^'"]+)['"]/.exec(slice);
  return m ? m[1] : undefined;
}

/**
 * ngx-translate 的模板写法：
 *   {{ 'key' | translate }}          {{ "key" | translate: params }}
 *   {{ 'key' | transloco }}
 *   [translate]="'key'"              translate="key"
 * 以及 vue-i18n 旧版过滤器 `{{ 'key' | t }}`。
 */
export function extractPipeKeys(text: string): RawCall[] {
  const out: RawCall[] = [];

  // {{ 'key' | translate }} —— hint 挂在 }} 之后
  const pipeRe = /\{\{\s*(['"])([^'"{}]+?)\1\s*\|\s*(?:translate|transloco|t)\b[^}]*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = pipeRe.exec(text)) !== null) {
    const keyStart = m.index + m[0].indexOf(m[1]);
    out.push({
      key: m[2].trim(),
      keyStart,
      keyEnd: keyStart + m[2].length + 2,
      hintOffset: m.index + m[0].length,
    });
  }

  // [translate]="'key'"  /  [transloco]="'key'"
  const bindRe = /\[(?:translate|transloco)\]\s*=\s*"(['`])([^'"`{}$]+?)\1"/g;
  while ((m = bindRe.exec(text)) !== null) {
    const keyStart = m.index + m[0].indexOf(m[2]);
    out.push({
      key: m[2].trim(),
      keyStart,
      keyEnd: keyStart + m[2].length,
      hintOffset: m.index + m[0].length,
    });
  }

  return out.filter((c) => c.key.length > 0);
}

/**
 * Angular 官方 i18n：
 *   $localize`:@@my.id:文案`      → key my.id
 *   <p i18n="@@my.id">文案</p>    → key my.id
 * 没有显式 id 的形式无法可靠对应语言文件，跳过。
 */
export function extractLocalizeKeys(text: string): RawCall[] {
  const out: RawCall[] = [];
  let m: RegExpExecArray | null;

  const tagged = /\$localize\s*`\s*:[^:`]*@@([^:`]+):/g;
  while ((m = tagged.exec(text)) !== null) {
    const keyStart = m.index + m[0].lastIndexOf(m[1]);
    out.push({
      key: m[1].trim(),
      keyStart,
      keyEnd: keyStart + m[1].length,
      hintOffset: m.index + m[0].length,
    });
  }

  const attr = /\bi18n(?:-[\w-]+)?\s*=\s*"[^"]*@@([^"|]+)"/g;
  while ((m = attr.exec(text)) !== null) {
    const keyStart = m.index + m[0].lastIndexOf(m[1]);
    out.push({
      key: m[1].trim(),
      keyStart,
      keyEnd: keyStart + m[1].length,
      hintOffset: m.index + m[0].length,
    });
  }

  return out.filter((c) => c.key.length > 0);
}

/**
 * React Intl：
 *   intl.formatMessage({ id: 'user.name', defaultMessage: 'Name' })
 *   formatMessage({ id: 'user.name' })
 *
 * descriptor 的字段顺序不固定，因此在第一个对象字面量内查找静态 id；变量 descriptor
 * 或动态 id 不做猜测。此处只匹配单层对象，满足最常见的直接调用形式。
 */
export function extractIntlMessageKeys(text: string): RawCall[] {
  const out: RawCall[] = [];
  const re = /\b(?:[A-Za-z_$][\w$]*\.)?formatMessage\s*\(\s*\{[^{}]*?\bid\s*:\s*(['"])([^'"]+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[2].trim();
    if (!key) {
      continue;
    }
    const keyStart = m.index + m[0].lastIndexOf(m[2]);
    out.push({
      key,
      keyStart,
      keyEnd: keyStart + m[2].length,
      hintOffset: findCallClose(text, m.index + m[0].indexOf('(')),
    });
  }
  return out;
}

/**
 * Vue 特有写法：
 *   v-t="'user.name'"
 *   <i18n-t keypath="user.name">   <i18n path="user.name">
 */
export function extractVueDirectiveKeys(text: string): RawCall[] {
  const out: RawCall[] = [];
  let m: RegExpExecArray | null;

  const vtRe = /v-t\s*=\s*"(\s*['"`])([^'"`$]+?)\1"/g;
  while ((m = vtRe.exec(text)) !== null) {
    const key = m[2].trim();
    if (!key) {
      continue;
    }
    const keyStart = m.index + m[0].indexOf(m[2]);
    out.push({ key, keyStart, keyEnd: keyStart + m[2].length, hintOffset: m.index + m[0].length });
  }

  for (const attr of ['keypath', 'path']) {
    const attrRe = new RegExp(`\\b${escapeRegExp(attr)}\\s*=\\s*"([^"$]+?)"`, 'g');
    while ((m = attrRe.exec(text)) !== null) {
      const key = m[1].trim();
      if (!key || key.includes('{')) {
        continue;
      }
      const keyStart = m.index + m[0].indexOf(m[1]);
      out.push({ key, keyStart, keyEnd: keyStart + m[1].length, hintOffset: m.index + m[0].length });
    }
  }

  return out;
}

/** 返回某个调用开括号对应的右括号之后的位置；不完整调用回落到文本末尾。 */
function findCallClose(text: string, openParen: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = openParen; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return text.length;
}
