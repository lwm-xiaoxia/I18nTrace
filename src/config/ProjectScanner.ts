import * as vscode from 'vscode';
import * as path from 'path';
import { I18nTraceConfig } from './ConfigService';
import { LocaleParserRegistry } from '../adapters/locale/registry';
import { isLocaleCode } from './localeCodes';
import { analyzeLocalePath } from './localePath';
import { logger } from '../util/logger';

/** 单次 findFiles 的命中上限，防止在超大仓库里扫穿。 */
const MAX_LOCALE_FILES = 5000;

export interface LocaleFile {
  uri: vscode.Uri;
  /** 推断出的 locale 代码，例如 zh-CN */
  locale: string;
  /** 推断出的命名空间（一个 locale 拆多文件时），单文件时为 undefined */
  namespace?: string;
  /** 所属工作区目录 */
  workspaceFolder: string;
  /**
   * 目录深度权重：越靠近工作区根越小。
   * 用于 monorepo / 多 locale 目录时 key 冲突的「就近覆盖」排序。
   */
  depth: number;
}

/**
 * 扫描工作区，定位语言文件并推断其 locale。
 * 自动检测目录用配置的 glob；当 localeDirs 非空时完全以配置为准。
 */
export class ProjectScanner {
  constructor(private readonly parsers: LocaleParserRegistry) {}

  async scan(config: I18nTraceConfig): Promise<LocaleFile[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return [];
    }

    const files: LocaleFile[] = [];
    for (const folder of folders) {
      const uris = await this.findInFolder(folder, config);
      for (const uri of uris) {
        const ext = path.extname(uri.fsPath).slice(1).toLowerCase();
        if (!this.parsers.supports(ext)) {
          continue;
        }
        const info = analyzeLocalePath(uri.fsPath);
        // 代码文件（js/ts）若既非 locale 命名、父目录也非 locale，多半是 i18n 的
        // 入口 / 工具文件（index.ts、helper.ts、types.ts），跳过以免污染 locale 列表与日志。
        // 用户用 localeDirs 显式指定时不做这层过滤（尊重用户判断）。
        if (
          config.localeDirs.length === 0 &&
          /^(js|ts|mjs|cjs)$/.test(ext) &&
          !isLocaleCode(info.locale)
        ) {
          continue;
        }
        const rel = path.relative(folder.uri.fsPath, uri.fsPath);
        files.push({
          uri,
          locale: info.locale,
          namespace: info.namespace,
          workspaceFolder: folder.uri.fsPath,
          depth: rel.split(/[\\/]/).length,
        });
      }
    }

    // 深的目录排在后面：rebuild 时后写入的覆盖前者 → 就近生效
    files.sort((a, b) => a.depth - b.depth);
    return files;
  }

  private async findInFolder(
    folder: vscode.WorkspaceFolder,
    config: I18nTraceConfig,
  ): Promise<vscode.Uri[]> {
    const exts = `{${this.parsers.supportedExtensions.join(',')}}`;

    if (config.localeDirs.length > 0) {
      const results: vscode.Uri[] = [];
      for (const entry of config.localeDirs) {
        const pattern = /[*?{}[\]]/.test(entry) ? entry : `${entry.replace(/[\\/]+$/, '')}/**/*.${exts}`;
        const found = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, pattern),
          '**/node_modules/**',
          MAX_LOCALE_FILES,
        );
        this.warnIfTruncated(found.length, pattern);
        results.push(...found);
      }
      return dedupe(results);
    }

    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, config.localeFileGlob),
      '**/node_modules/**',
      MAX_LOCALE_FILES,
    );
    this.warnIfTruncated(found.length, config.localeFileGlob);
    return found;
  }

  /**
   * findFiles 命中上限时会静默截断，用户只会看到「有些 key 没气泡」却查不出原因，
   * 因此把它显式记进输出频道。
   */
  private warnIfTruncated(count: number, pattern: string): void {
    if (count >= MAX_LOCALE_FILES) {
      logger.warn(
        `匹配到的语言文件已达上限 ${MAX_LOCALE_FILES}，超出的被忽略（glob: ${pattern}）。` +
          '建议用 i18nTrace.localeDirs 缩小范围。',
      );
    }
  }
}

/**
 * 从文件路径推断 locale。命名空间一并推断时请直接用 {@link analyzeLocalePath}。
 * 推断不出时返回不含扩展名的文件名（调用方据此可判断「非语言文件」）。
 */
export function inferLocale(uri: vscode.Uri): string {
  return analyzeLocalePath(uri.fsPath).locale;
}

function dedupe(uris: vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  return uris.filter((u) => {
    const k = u.toString();
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}
