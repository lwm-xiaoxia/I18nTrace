import * as vscode from 'vscode';

/**
 * 一条被拍平的翻译条目，来自某个语言文件。
 * 只有「值为字符串」的叶子节点才会产生 LocaleEntry；对象/数组中间节点不产生。
 */
export interface LocaleEntry {
  /** 拍平后的 key，例如 "user.name" */
  key: string;
  /** locale 代码，例如 "zh-CN" */
  locale: string;
  /** 译文文本 */
  value: string;
  /** 来源语言文件 */
  uri: vscode.Uri;
  /**
   * key 在源文件中的定义位置（用于点击气泡跳转）。
   * 解析器能算出就带上，算不出可省略。
   */
  range?: vscode.Range;
}

/** 语言文件解析器。新增格式 = 新增一个实现并注册，不改核心。 */
export interface LocaleParser {
  /** 支持的扩展名（小写，不含点），例如 ["json"]、["yaml", "yml"] */
  readonly extensions: readonly string[];
  /**
   * @param uri 语言文件
   * @param text 文件内容
   * @param locale 该文件对应的 locale 代码（由 ProjectScanner 推断后传入）
   */
  parse(uri: vscode.Uri, text: string, locale: string): LocaleEntry[];
}

/** 代码中的一处 i18n 调用（已确定 key 为静态字符串）。 */
export interface I18nCall {
  /** key 文本，例如 "user.name" */
  key: string;
  /** 可选命名空间（react-i18next 的 useTranslation('ns') 等），用于 key 解析回退 */
  namespace?: string;
  /** key 字符串字面量（含引号）在文档中的范围 */
  keyRange: vscode.Range;
  /** Inlay Hint 锚点位置（通常是调用右括号之后） */
  hintPosition: vscode.Position;
}

/** 框架适配器：从文档中提取 i18n 调用。新增框架 = 新增一个实现并注册，不改核心。 */
export interface FrameworkAdapter {
  readonly id: string;
  /** 适用的 languageId 列表 */
  readonly languages: readonly string[];
  /**
   * 提取给定范围内的 i18n 调用。
   * 动态 key（模板串含 ${}、变量、拼接）必须跳过，不得猜测。
   */
  extractCalls(
    document: vscode.TextDocument,
    range: vscode.Range,
    ctx: ExtractContext,
  ): I18nCall[];
}

export interface ExtractContext {
  /** 识别为翻译函数的名称集合（支持点号形式，如 i18n.t） */
  readonly functionNames: readonly string[];
}
