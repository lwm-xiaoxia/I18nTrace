import * as vscode from 'vscode';
import JSON5 from 'json5';
import { LocaleEntry, LocaleParser, ParseContext } from '../../core/types';
import { flattenLocaleObject } from './flatten';

/**
 * JSON / JSON5 语言文件解析。
 * JSON5 是 JSON 的超集（允许注释、尾逗号、单引号、无引号 key），
 * 用一个解析器覆盖两种扩展名即可。
 */
export class JsonParser implements LocaleParser {
  readonly extensions = ['json', 'json5'] as const;

  parse(uri: vscode.Uri, text: string, ctx: ParseContext): LocaleEntry[] {
    let data: unknown;
    try {
      data = JSON5.parse(text);
    } catch (err) {
      console.warn(`[I18nTrace] JSON 解析失败: ${uri.fsPath}`, (err as Error).message);
      return [];
    }
    return flattenLocaleObject(data, uri, ctx, text);
  }
}
