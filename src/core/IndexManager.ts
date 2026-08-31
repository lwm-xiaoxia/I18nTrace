import * as vscode from 'vscode';
import * as path from 'path';
import { I18nIndex } from './I18nIndex';
import { LocaleParserRegistry } from '../adapters/locale/registry';
import { ProjectScanner, LocaleFile, inferLocale } from '../config/ProjectScanner';
import { ConfigService } from '../config/ConfigService';
import { DisposableStore } from '../util/disposable';

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

      const files = await this.scanner.scan(this.config.value);
      for (const file of files) {
        this.fileLocale.set(file.uri.toString(), file.locale);
        await this.parseInto(file);
      }
      console.log(
        `[LocaleTrace] 索引完成：${files.length} 个语言文件，locale = [${this.index
          .getLocales()
          .join(', ')}]`,
      );
    } finally {
      this.building = false;
    }
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

  private async parseInto(file: LocaleFile): Promise<void> {
    const ext = path.extname(file.uri.fsPath).slice(1).toLowerCase();
    const parser = this.parsers.get(ext);
    if (!parser) {
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(file.uri);
      const text = Buffer.from(bytes).toString('utf8');
      const entries = parser.parse(file.uri, text, file.locale);
      this.index.replaceFile(file.uri, entries);
    } catch (err) {
      console.warn(`[LocaleTrace] 读取语言文件失败: ${file.uri.fsPath}`, (err as Error).message);
      this.index.replaceFile(file.uri, []);
    }
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
      // 配置了但当前没有该 locale，仍返回它（可能语言文件尚未加载）
      return configured;
    }
    return locales.find((l) => /^zh/i.test(l)) ?? locales[0];
  }
}
