import * as vscode from 'vscode';
import { DisposableStore } from '../util/disposable';

export interface I18nTraceConfig {
  enabled: boolean;
  localeDirs: string[];
  localeFileGlob: string;
  displayLocale: string;
  sourceLocale: string;
  /** 嵌套对象拍平时使用的 key 分隔符。 */
  keySeparator: string;
  /** 自定义翻译函数可能使用的 key 前缀；仅在原 key 查不到时才剥离。 */
  keyPrefixes: string[];
  translationFunctions: string[];
  inlayHints: {
    enabled: boolean;
    maxLength: number;
    showWhenMissing: boolean;
    /** 译文两侧的包裹符，如 "「」"；"none" 表示不包裹 */
    wrap: string;
  };
  languageSelector: string[];
  search: {
    enhanceCtrlF: boolean;
    maxKeysPerSearch: number;
  };
}

const SECTION = 'i18nTrace';

/**
 * 读取并缓存 i18nTrace.* 配置，配置变化时对外广播。
 * 提供「结构性配置变化」与「显示性配置变化」的区分，避免每次都重建索引。
 */
export class ConfigService {
  private readonly store = new DisposableStore();
  private current: I18nTraceConfig;

  private readonly structuralEmitter = new vscode.EventEmitter<void>();
  /** 影响索引构建的配置变化（目录、glob、key 分隔符）。订阅方应重建索引。 */
  readonly onDidChangeStructural = this.structuralEmitter.event;

  private readonly displayEmitter = new vscode.EventEmitter<void>();
  /** 仅影响展示/搜索的配置变化（displayLocale、气泡长度、翻译函数名等）。 */
  readonly onDidChangeDisplay = this.displayEmitter.event;

  constructor() {
    this.current = read();
    this.store.add(this.structuralEmitter);
    this.store.add(this.displayEmitter);
    this.store.add(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration(SECTION)) {
          return;
        }
        const prev = this.current;
        this.current = read();
        if (isStructuralChange(prev, this.current)) {
          this.structuralEmitter.fire();
        }
        this.displayEmitter.fire();
      }),
    );
  }

  get value(): I18nTraceConfig {
    return this.current;
  }

  /** 持久化 displayLocale（切换显示语种命令用）。 */
  async setDisplayLocale(locale: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('displayLocale', locale, vscode.ConfigurationTarget.Workspace);
  }

  async setInlayHintsEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('inlayHints.enabled', enabled, vscode.ConfigurationTarget.Workspace);
  }

  dispose(): void {
    this.store.dispose();
  }
}

function read(): I18nTraceConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: c.get('enabled', true),
    localeDirs: c.get('localeDirs', []),
    localeFileGlob: c.get(
      'localeFileGlob',
      '**/{locale,locales,lang,langs,language,languages,i18n,i18n-locales,intl,translation,translations,messages}/**/*.{json,json5,yaml,yml,js,ts,mjs,cjs}',
    ),
    displayLocale: c.get('displayLocale', ''),
    sourceLocale: c.get('sourceLocale', ''),
    keySeparator: c.get('keySeparator', '.'),
    keyPrefixes: c.get('keyPrefixes', ['++', '+', '@', '#']),
    translationFunctions: c.get('translationFunctions', [
      't',
      '$t',
      'i18n.t',
      'i18n.global.t',
      'translate',
      '$translate',
    ]),
    inlayHints: {
      enabled: c.get('inlayHints.enabled', true),
      maxLength: c.get('inlayHints.maxLength', 40),
      showWhenMissing: c.get('inlayHints.showWhenMissing', true),
      wrap: c.get('inlayHints.wrap', 'none'),
    },
    languageSelector: c.get('languageSelector', [
      'javascript',
      'javascriptreact',
      'typescript',
      'typescriptreact',
      'vue',
      'html',
      'svelte',
    ]),
    search: {
      enhanceCtrlF: c.get('search.enhanceCtrlF', true),
      maxKeysPerSearch: c.get('search.maxKeysPerSearch', 50),
    },
  };
}

function isStructuralChange(a: I18nTraceConfig, b: I18nTraceConfig): boolean {
  return (
    a.enabled !== b.enabled ||
    a.localeFileGlob !== b.localeFileGlob ||
    a.keySeparator !== b.keySeparator ||
    JSON.stringify(a.localeDirs) !== JSON.stringify(b.localeDirs)
  );
}
