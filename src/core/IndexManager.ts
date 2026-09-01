import * as vscode from 'vscode';
import * as path from 'path';
import { I18nIndex } from './I18nIndex';
import { LocaleParserRegistry } from '../adapters/locale/registry';
import { ProjectScanner, LocaleFile, inferLocale } from '../config/ProjectScanner';
import { ConfigService } from '../config/ConfigService';
import { DisposableStore } from '../util/disposable';
import { logger } from '../util/logger';

/** 单个语言文件的解析结果，供诊断报告使用。 */
export interface FileDiag {
  path: string;
  locale: string;
  entries: number;
  error?: string;
}

/**
 * 负责把「语言文件」变成「索引内容」，并维护增量更新。
 * - 首次 / 结构性配置变化：全量 scan + 解析
 * - 单个语言文件增删改：只重解析该文件
 */
export class IndexManager {
  readonly index = new I18nIndex();
  private readonly store = new DisposableStore();

  /** uriString → 该文件推断出的 locale，供单文件更新时复用 */
  private fileLocale = new Map<string, string>();
  private building = false;

  /** 上一次全量扫描的每文件结果，供 i18nTrace.showDiagnostics 使用 */
  private lastScan: FileDiag[] = [];
  private lastScanMeta = '';

  constructor(
    private readonly config: ConfigService,
    private readonly parsers: LocaleParserRegistry,
    private readonly scanner: ProjectScanner,
  ) {
    this.store.add(this.index);
  }

  dispose(): void {
    this.store.dispose();
  }

  /** 该 uri 是否是当前索引纳入的语言文件。 */
  isTrackedLocaleFile(uri: vscode.Uri): boolean {
    return this.fileLocale.has(uri.toString());
  }

  /** 供 watcher 判断新建文件是否符合语言文件命名。 */
  supportsExtension(uri: vscode.Uri): boolean {
    return this.parsers.supports(path.extname(uri.fsPath).slice(1));
  }

  async rebuild(): Promise<void> {
    if (this.building) {
      return;
    }
    this.building = true;
    try {
      this.fileLocale.clear();
      this.index.clear();

      if (!this.config.value.enabled) {
        return;
      }

      const cfg = this.config.value;
      this.lastScanMeta =
        cfg.localeDirs.length > 0
          ? `localeDirs = ${JSON.stringify(cfg.localeDirs)}`
          : `localeFileGlob = ${cfg.localeFileGlob}`;

      const files = await this.scanner.scan(cfg);
      this.lastScan = [];
      for (const file of files) {
        this.fileLocale.set(file.uri.toString(), file.locale);
        const diag = await this.parseInto(file);
        this.lastScan.push(diag);
      }

      const summary = `索引完成：${files.length} 个语言文件，${this.index
        .getLocales()
        .length} 个 locale [${this.index.getLocales().join(', ')}]，共 ${this.lastScan.reduce(
        (n, d) => n + d.entries,
        0,
      )} 条 key`;
      logger.info(summary);
      if (files.length === 0) {
        logger.warn(
          `没有扫到任何语言文件。检查 ${this.lastScanMeta}，或用设置 i18nTrace.localeDirs 手动指定目录。`,
        );
      }
      for (const d of this.lastScan) {
        if (d.error) {
          logger.warn(`${d.path} 解析失败：${d.error}`);
        } else if (d.entries === 0) {
          logger.warn(`${d.path} 解析出 0 条 key（格式可能不受支持，如通过 import 组合的模块）`);
        }
      }
    } finally {
      this.building = false;
    }
  }

  /** 生成一份可读的诊断报告（供命令写入输出频道）。 */
  buildDiagnosticsReport(activeDoc?: vscode.TextDocument): string {
    const lines: string[] = [];
    lines.push('════════ I18nTrace 诊断 ════════');
    lines.push(`工作区：${(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath).join(', ') || '（无）'}`);
    lines.push(`扫描依据：${this.lastScanMeta || '（尚未扫描）'}`);
    lines.push(`locale：[${this.index.getLocales().join(', ') || '无'}]`);
    lines.push(`displayLocale：${this.resolveDisplayLocale() ?? '（无）'}`);
    lines.push(`总 key 数：${this.lastScan.reduce((n, d) => n + d.entries, 0)}`);
    lines.push('');
    lines.push('语言文件：');
    if (this.lastScan.length === 0) {
      lines.push('  （未扫到任何语言文件）');
    }
    for (const d of this.lastScan) {
      const tag = d.error ? `解析失败: ${d.error}` : `${d.entries} key`;
      lines.push(`  [${d.locale}] ${d.path} — ${tag}`);
    }

    if (activeDoc) {
      lines.push('');
      lines.push(`当前文件：${activeDoc.uri.fsPath}（languageId=${activeDoc.languageId}）`);
    }
    lines.push('═══════════════════════════════');
    return lines.join('\n');
  }

  /** 查某个 key 当前索引里的状态（诊断命令用）。 */
  lookupKey(key: string): { locales: string[]; sample?: string } {
    const all = this.index.getAllForKey(key);
    if (!all) {
      return { locales: [] };
    }
    const first = [...all.values()][0];
    return { locales: [...all.keys()], sample: first?.value };
  }

  async updateFile(uri: vscode.Uri): Promise<void> {
    if (!this.config.value.enabled || !this.supportsExtension(uri)) {
      return;
    }
    let locale = this.fileLocale.get(uri.toString());
    if (!locale) {
      // 新建文件：重新推断并纳入
      locale = inferLocale(uri);
      this.fileLocale.set(uri.toString(), locale);
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    await this.parseInto({
      uri,
      locale,
      workspaceFolder: folder?.uri.fsPath ?? '',
      depth: 0,
    });
  }

  removeFile(uri: vscode.Uri): void {
    if (this.fileLocale.delete(uri.toString())) {
      this.index.removeFile(uri);
    }
  }

  private async parseInto(file: LocaleFile): Promise<FileDiag> {
    const rel = this.relPath(file.uri);
    const ext = path.extname(file.uri.fsPath).slice(1).toLowerCase();
    const parser = this.parsers.get(ext);
    if (!parser) {
      return { path: rel, locale: file.locale, entries: 0, error: `无 .${ext} 解析器` };
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(file.uri);
      const text = Buffer.from(bytes).toString('utf8');
      const entries = parser.parse(file.uri, text, file.locale);
      this.index.replaceFile(file.uri, entries);
      return { path: rel, locale: file.locale, entries: entries.length };
    } catch (err) {
      this.index.replaceFile(file.uri, []);
      return { path: rel, locale: file.locale, entries: 0, error: (err as Error).message };
    }
  }

  private relPath(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? path.relative(folder.uri.fsPath, uri.fsPath) : uri.fsPath;
  }

  /**
   * 决定气泡显示用的 locale：
   *   配置 displayLocale > 含 "zh" 的 locale > 第一个 locale
   */
  resolveDisplayLocale(): string | undefined {
    const configured = this.config.value.displayLocale.trim();
    const locales = this.index.getLocales();
    if (configured && locales.includes(configured)) {
      return configured;
    }
    if (configured) {
      // 配置了但当前没有该 locale，回落到第一个实际存在的（优先中文）
      return locales.find((l) => /^zh/i.test(l)) ?? locales[0];
    }
    return locales.find((l) => /^zh/i.test(l)) ?? locales[0];
  }
}
