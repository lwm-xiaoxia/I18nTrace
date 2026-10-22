import * as vscode from 'vscode';
import * as path from 'path';
import { I18nIndex } from './I18nIndex';
import { LocaleParserRegistry } from '../adapters/locale/registry';
import { ProjectScanner, LocaleFile } from '../config/ProjectScanner';
import { ConfigService } from '../config/ConfigService';
import { analyzeLocalePath } from '../config/localePath';
import { DisposableStore } from '../util/disposable';
import { logger } from '../util/logger';

/** 精确排除列表的长度上限，超过则退化为目录 glob。 */
const MAX_EXCLUDE_GLOB_LENGTH = 4000;

/** 单个语言文件的解析结果，供诊断报告使用。 */
export interface FileDiag {
  path: string;
  locale: string;
  namespace?: string;
  entries: number;
  error?: string;
}

/**
 * 负责把「语言文件」变成「索引内容」，并维护增量更新。
 * - 首次 / 结构性配置变化：全量 scan + 解析
 * - 单个语言文件增删改：只重解析该文件
 */
export class IndexManager {
  private readonly store = new DisposableStore();
  /** 每个项目根目录拥有独立索引；无项目上下文时返回空索引，不能借用其它项目。 */
  private readonly projectIndexes = new Map<string, I18nIndex>();
  private readonly emptyIndex = new I18nIndex();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  /** 命令默认使用活动文件所属项目；只有一个根目录时允许无活动文件。 */
  get index(): I18nIndex {
    return this.getIndex();
  }

  getProjectFolder(resource?: vscode.Uri): vscode.WorkspaceFolder | undefined {
    const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (uri) {
      return vscode.workspace.getWorkspaceFolder(uri);
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    return folders.length === 1 ? folders[0] : undefined;
  }

  /** 编辑器提供者必须显式传入正在处理的文档，不能依赖活动编辑器。 */
  getIndex(resource?: vscode.Uri): I18nIndex {
    const folder = this.getProjectFolder(resource);
    return folder ? this.projectIndexes.get(folder.uri.fsPath) ?? this.emptyIndex : this.emptyIndex;
  }

  /** uriString → 该文件的完整扫描信息，供单文件增量更新时复用。 */
  private fileInfo = new Map<string, LocaleFile>();
  /** 进行中的全量构建；并发调用共享同一个 Promise，构建期间又被请求则结束后再跑一次 */
  private buildInFlight: Promise<void> | null = null;
  private buildQueued = false;

  /** 上一次全量扫描的每文件结果，供 i18nTrace.showDiagnostics 使用 */
  private lastScan: FileDiag[] = [];
  private lastScanMeta = '';

  constructor(
    private readonly config: ConfigService,
    private readonly parsers: LocaleParserRegistry,
    private readonly scanner: ProjectScanner,
  ) {
    this.store.add(this.emptyIndex);
    this.store.add(this.changeEmitter);
    this.syncIndexOptions();
    // key 前缀不改变索引内容，只影响代码调用与索引 key 的解析；配置变更后立即生效。
    this.store.add(this.config.onDidChangeDisplay(() => this.syncIndexOptions()));
  }

  dispose(): void {
    for (const index of this.projectIndexes.values()) {
      index.dispose();
    }
    this.projectIndexes.clear();
    this.store.dispose();
  }

  /** 该 uri 是否是当前索引纳入的语言文件。 */
  isTrackedLocaleFile(uri: vscode.Uri): boolean {
    return this.fileInfo.has(uri.toString());
  }

  /** 供 watcher 判断新建文件是否符合语言文件命名。 */
  supportsExtension(uri: vscode.Uri): boolean {
    return this.parsers.supports(path.extname(uri.fsPath).slice(1));
  }

  /**
   * 全量重建索引。并发安全：构建进行中时再次调用会复用同一个 Promise，
   * 且在当前构建结束后自动再跑一次（覆盖构建期间发生的配置 / 目录变化）。
   * 调用方 await 到的 Promise 一定在「索引已就绪」时才 resolve。
   */
  rebuild(): Promise<void> {
    if (this.buildInFlight) {
      this.buildQueued = true;
      return this.buildInFlight;
    }
    this.buildInFlight = (async () => {
      try {
        do {
          this.buildQueued = false;
          await this.doRebuild();
        } while (this.buildQueued);
      } finally {
        this.buildInFlight = null;
      }
    })();
    return this.buildInFlight;
  }

  private async doRebuild(): Promise<void> {
    // 整轮重建包在一个批次里：只重算一次派生结构、只广播一次刷新，
    // 且扫描期间索引仍持有上一轮数据，气泡不会先消失再出现。
    const folders = vscode.workspace.workspaceFolders ?? [];
    const roots = new Set(folders.map((folder) => folder.uri.fsPath));
    for (const [root, index] of this.projectIndexes) {
      if (!roots.has(root)) {
        index.dispose();
        this.projectIndexes.delete(root);
      }
    }
    for (const root of roots) {
      if (!this.projectIndexes.has(root)) {
        const index = new I18nIndex();
        index.setOptions({ keyPrefixes: this.config.value.keyPrefixes });
        this.projectIndexes.set(root, index);
      }
    }
    const indexes = [...this.projectIndexes.values()];
    for (const index of indexes) {
      index.beginBatch();
      index.clear();
    }
    let files: LocaleFile[] = [];
    try {
      this.fileInfo.clear();
      this.lastScan = [];

      if (!this.config.value.enabled) {
        return;
      }

      const cfg = this.config.value;
      this.lastScanMeta =
        cfg.localeDirs.length > 0
          ? `localeDirs = ${JSON.stringify(cfg.localeDirs)}`
          : `localeFileGlob = ${cfg.localeFileGlob}`;

      files = await this.scanner.scan(cfg);
      for (const file of files) {
        this.fileInfo.set(file.uri.toString(), file);
        const diag = await this.parseInto(file);
        this.lastScan.push(diag);
      }
    } finally {
      for (const index of indexes) {
        index.endBatch();
      }
      this.changeEmitter.fire();
    }

    const locales = [...new Set(indexes.flatMap((index) => index.getLocales()))].sort();
    const summary = `索引完成：${files.length} 个语言文件，${
      this.projectIndexes.size
    } 个项目，${locales.length} 个 locale [${locales.join(', ')}]，共 ${this.lastScan.reduce(
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
  }

  /**
   * 生成「在文件中查找」用的排除 glob（逗号分隔），把语言文件本身挡在结果之外。
   * 否则全局按译文查找时，语言包里的 key 定义行会占掉一大半结果。
   *
   * 默认逐个文件精确排除；文件很多（如 i18next 按命名空间拆成上百个 JSON）时
   * 精确列表会过长，退化为这些文件所在目录的 dir/** —— 目录内本就只放语言文件，
   * 误伤概率低，且比截断列表更符合预期。
   */
  buildLocaleExcludeGlob(resource?: vscode.Uri): string {
    const folder = this.getProjectFolder(resource);
    const files: string[] = [];
    for (const file of this.fileInfo.values()) {
      if (file.workspaceFolder !== folder?.uri.fsPath) {
        continue;
      }
      files.push(toGlobPath(this.relPath(file.uri)));
    }
    if (files.length === 0) {
      return '';
    }

    const exact = [...new Set(files)].sort();
    const joined = exact.join(',');
    if (joined.length <= MAX_EXCLUDE_GLOB_LENGTH) {
      return joined;
    }

    const dirs = new Set<string>();
    for (const p of exact) {
      const idx = p.lastIndexOf('/');
      dirs.add(idx === -1 ? '*' : p.slice(0, idx) + '/**');
    }
    const fallback = [...dirs].sort().join(',');
    logger.info(
      `语言文件较多（${exact.length} 个），全局查找的排除范围按目录聚合：${fallback}`,
    );
    return fallback;
  }

  /** 生成一份可读的诊断报告（供命令写入输出频道）。 */
  buildDiagnosticsReport(activeDoc?: vscode.TextDocument): string {
    const resource = activeDoc?.uri;
    const folder = this.getProjectFolder(resource);
    const index = this.getIndex(resource);
    const lines: string[] = [];
    lines.push('════════ I18nTrace 诊断 ════════');
    lines.push(`工作区：${(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath).join(', ') || '（无）'}`);
    lines.push(`扫描依据：${this.lastScanMeta || '（尚未扫描）'}`);
    lines.push(`当前项目：${folder?.uri.fsPath ?? '（无，请打开项目内的文件）'}`);
    lines.push(`locale：[${index.getLocales().join(', ') || '无'}]`);
    lines.push(`displayLocale：${this.resolveDisplayLocale(resource) ?? '（无）'}`);
    lines.push(`sourceLocale：${this.resolveSourceLocale(resource) ?? '（无）'}`);
    lines.push(`命名空间：[${index.getNamespaces().join(', ') || '无'}]`);
    lines.push(`工作区总 key 数：${this.lastScan.reduce((n, d) => n + d.entries, 0)}`);
    lines.push('');
    lines.push('工作区语言文件（按项目分别索引）：');
    if (this.lastScan.length === 0) {
      lines.push('  （未扫到任何语言文件）');
    }
    for (const d of this.lastScan) {
      const tag = d.error ? `解析失败: ${d.error}` : `${d.entries} key`;
      const namespace = d.namespace ? ` ns=${d.namespace}` : '';
      lines.push(`  [${d.locale}${namespace}] ${d.path} — ${tag}`);
    }

    if (activeDoc) {
      lines.push('');
      lines.push(`当前文件：${activeDoc.uri.fsPath}（languageId=${activeDoc.languageId}）`);
    }
    lines.push('═══════════════════════════════');
    return lines.join('\n');
  }

  /** 查某个 key 当前索引里的状态（诊断命令用）。 */
  lookupKey(key: string, resource?: vscode.Uri): { locales: string[]; sample?: string } {
    const all = this.getIndex(resource).getAllForKey(key);
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
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || !this.projectIndexes.has(folder.uri.fsPath)) {
      return;
    }
    let file = this.fileInfo.get(uri.toString());
    if (!file) {
      // 新建文件：重新推断并纳入
      const info = analyzeLocalePath(uri.fsPath);
      file = {
        uri,
        locale: info.locale,
        namespace: info.namespace,
        workspaceFolder: folder.uri.fsPath,
        depth: 0,
      };
      this.fileInfo.set(uri.toString(), file);
    }
    await this.parseInto(file);
    this.changeEmitter.fire();
  }

  removeFile(uri: vscode.Uri): void {
    const file = this.fileInfo.get(uri.toString());
    if (file && this.fileInfo.delete(uri.toString())) {
      this.projectIndexes.get(file.workspaceFolder)?.removeFile(uri);
      this.changeEmitter.fire();
    }
  }

  private async parseInto(file: LocaleFile): Promise<FileDiag> {
    const rel = vscode.workspace.asRelativePath(file.uri, true);
    const ext = path.extname(file.uri.fsPath).slice(1).toLowerCase();
    const parser = this.parsers.get(ext);
    if (!parser) {
      return {
        path: rel,
        locale: file.locale,
        namespace: file.namespace,
        entries: 0,
        error: `无 .${ext} 解析器`,
      };
    }
    try {
      const text = await readLocaleText(file.uri);
      const entries = parser.parse(file.uri, text, {
        locale: file.locale,
        namespace: file.namespace,
        keySeparator: this.config.value.keySeparator,
      });
      this.projectIndexes.get(file.workspaceFolder)?.replaceFile(file.uri, entries);
      return {
        path: rel,
        locale: file.locale,
        namespace: file.namespace,
        entries: entries.length,
      };
    } catch (err) {
      this.projectIndexes.get(file.workspaceFolder)?.replaceFile(file.uri, []);
      return {
        path: rel,
        locale: file.locale,
        namespace: file.namespace,
        entries: 0,
        error: (err as Error).message,
      };
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
  resolveDisplayLocale(resource?: vscode.Uri): string | undefined {
    const configured = this.config.value.displayLocale.trim();
    const locales = this.getIndex(resource).getLocales();
    if (configured && locales.includes(configured)) {
      return configured;
    }
    if (configured) {
      // 配置了但当前没有该 locale，回落到第一个实际存在的（优先中文）
      return locales.find((l) => /^zh/i.test(l)) ?? locales[0];
    }
    return locales.find((l) => /^zh/i.test(l)) ?? locales[0];
  }

  /**
   * 决定 Ctrl+F 按译文反查使用的 locale。
   * 显式 sourceLocale 优先；未配置时保持原行为，跟随显示语种。
   */
  resolveSourceLocale(resource?: vscode.Uri): string | undefined {
    const configured = this.config.value.sourceLocale.trim();
    const locales = this.getIndex(resource).getLocales();
    if (configured && locales.includes(configured)) {
      return configured;
    }
    return this.resolveDisplayLocale(resource);
  }

  private syncIndexOptions(): void {
    for (const index of this.projectIndexes.values()) {
      index.setOptions({ keyPrefixes: this.config.value.keyPrefixes });
    }
  }
}

/** Windows 下 relPath 返回反斜杠，glob 统一用正斜杠。 */
export function toGlobPath(rel: string): string {
  return rel.split(path.sep).join('/');
}

/**
 * 读取语言文件文本，编辑器里已打开的以缓冲区内容为准。
 *
 * `workspace.fs.readFile` 读的是磁盘，而 LocaleWatcher 监听了
 * `onDidChangeTextDocument`（未保存的编辑）。只读磁盘的话，改完语言文件必须先保存
 * 气泡才会变，与「含未保存的编辑」的行为承诺不符。
 */
async function readLocaleText(uri: vscode.Uri): Promise<string> {
  const target = uri.toString();
  const open = vscode.workspace.textDocuments.find(
    (doc) => !doc.isClosed && doc.uri.toString() === target,
  );
  if (open) {
    return open.getText();
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}
