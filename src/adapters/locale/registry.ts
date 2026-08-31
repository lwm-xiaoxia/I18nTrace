import { LocaleParser } from '../../core/types';
import { JsonParser } from './JsonParser';
import { YamlParser } from './YamlParser';
import { JsModuleParser } from './JsModuleParser';

/**
 * 语言文件解析器注册表。
 * 新增格式：实现 LocaleParser，在这里 push 一次即可，核心索引/气泡/搜索都不用动。
 */
export class LocaleParserRegistry {
  private readonly byExt = new Map<string, LocaleParser>();

  constructor(parsers: LocaleParser[] = defaultLocaleParsers()) {
    for (const parser of parsers) {
      for (const ext of parser.extensions) {
        this.byExt.set(ext.toLowerCase(), parser);
      }
    }
  }

  /** 是否有解析器能处理该扩展名（不含点，小写）。 */
  supports(ext: string): boolean {
    return this.byExt.has(ext.toLowerCase());
  }

  get(ext: string): LocaleParser | undefined {
    return this.byExt.get(ext.toLowerCase());
  }

  get supportedExtensions(): string[] {
    return [...this.byExt.keys()];
  }
}

export function defaultLocaleParsers(): LocaleParser[] {
  return [new JsonParser(), new YamlParser(), new JsModuleParser()];
}
