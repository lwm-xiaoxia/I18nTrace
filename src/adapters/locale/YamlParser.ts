import * as vscode from 'vscode';
import { parseDocument, isScalar, isMap, isSeq, Node } from 'yaml';
import { LocaleEntry, LocaleParser, ParseContext } from '../../core/types';
import { KEY_SEPARATOR } from './flatten';

/**
 * YAML / YML 语言文件解析。
 * 用 yaml 库的文档 AST 直接拿到每个叶子节点的字符区间，定位比 JSON 更精确。
 */
export class YamlParser implements LocaleParser {
  readonly extensions = ['yaml', 'yml'] as const;

  parse(uri: vscode.Uri, text: string, ctx: ParseContext): LocaleEntry[] {
    let doc: ReturnType<typeof parseDocument>;
    try {
      doc = parseDocument(text, { keepSourceTokens: false });
    } catch (err) {
      console.warn(`[I18nTrace] YAML 解析失败: ${uri.fsPath}`, (err as Error).message);
      return [];
    }
    if (doc.errors.length > 0) {
      console.warn(`[I18nTrace] YAML 存在错误: ${uri.fsPath}`, doc.errors[0].message);
    }

    const entries: LocaleEntry[] = [];
    const offsets = new LineOffsets(text);

    const walk = (node: unknown, path: string[]): void => {
      if (isMap(node)) {
        for (const item of node.items) {
          const keyNode = item.key as Node;
          const k = isScalar(keyNode) ? String(keyNode.value) : String(keyNode);
          walk(item.value, [...path, k]);
        }
        return;
      }
      if (isSeq(node)) {
        node.items.forEach((item, i) => walk(item, [...path, String(i)]));
        return;
      }
      if (isScalar(node)) {
        if (node.value === null || node.value === undefined || path.length === 0) {
          return;
        }
        const range = (node as Node).range;
        entries.push({
          key: path.join(ctx.keySeparator || KEY_SEPARATOR),
          namespace: ctx.namespace,
          locale: ctx.locale,
          value: String(node.value),
          uri,
          range: range ? offsets.toRange(range[0], range[1]) : undefined,
        });
      }
    };

    walk(doc.contents, []);
    return entries;
  }
}

/** 把字符 offset 转成 vscode.Position/Range。 */
class LineOffsets {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        this.starts.push(i + 1);
      }
    }
  }

  private toPos(offset: number): vscode.Position {
    let line = 0;
    for (let i = 0; i < this.starts.length; i++) {
      if (this.starts[i] > offset) {
        break;
      }
      line = i;
    }
    return new vscode.Position(line, offset - this.starts[line]);
  }

  toRange(start: number, end: number): vscode.Range {
    return new vscode.Range(this.toPos(start), this.toPos(end));
  }
}
