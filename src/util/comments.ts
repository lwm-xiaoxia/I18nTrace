/**
 * 注释屏蔽：把注释内容替换成等长空格，保持所有 offset 不变。
 *
 * 源码侧用它避免给注释掉的 `t('x')` 挂气泡；JS/TS 语言文件解析也用它，
 * 因为按正则删注释会误伤译文里的 `//`（`"路径 a//b"`），
 * 导致整份语言文件解析失败、所有 key 一起丢失。
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
