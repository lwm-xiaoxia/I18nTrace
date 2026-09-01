import * as vscode from 'vscode';

/**
 * 一条被拍平的翻译条目，来自某个语言文件。
 * 只有「值为字符串」的叶子节点才会产生 LocaleEntry；对象/数组中间节点不产生。
 */
export interface LocaleEntry {
  /** 文件内拍平后的 key，例如 "user.name"（不含命名空间） */
  key: string;
  /**
   * 命名空间。一个 locale 拆成多个文件时（i18next 的 locales/en/common.json、
   * 或 i18n/common/en.json）取自文件名 / 目录名；单文件 locale 则为 undefined。
   */
  namespace?: string;
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

/** 解析器拿到的上下文（由 ProjectScanner 推断后传入）。 */
export interface ParseContext {
  /** 该文件对应的 locale 代码 */
  readonly locale: string;
  /** 该文件对应的命名空间；单文件 locale 时为 undefined */
  readonly namespace?: string;
  /** 拍平嵌套对象时使用的 key 分隔符 */
  readonly keySeparator: string;
}

/** 语言文件解析器。新增格式 = 新增一个实现并注册，不改核心。 */
export interface LocaleParser {
  /** 支持的扩展名（小写，不含点），例如 ["json"]、["yaml", "yml"] */
  readonly extensions: readonly string[];
  parse(uri: vscode.Uri, text: string, ctx: ParseContext): LocaleEntry[];
}

/** 代码中的一处 i18n 调用（已确定 key 为静态字符串）。 */
export interface I18nCall {
  /** key 文本，例如 "user.name"、"common:save" */
  key: string;
  /**
   * 调用点已知的命名空间。来源：`t('k', { ns: 'x' })`、
   * `useTranslation('x')` / `useI18n({ ns })` 等文件级声明。
   */
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
  /**
   * 整篇文档文本。用于抽取文件级默认命名空间（`useTranslation('ns')`），
   * 与按可视区传入的 range 无关。
   */
  readonly fullText?: string;
}
