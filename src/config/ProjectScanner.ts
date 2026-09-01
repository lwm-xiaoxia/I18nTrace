import * as vscode from 'vscode';
import * as path from 'path';
import { I18nTraceConfig } from './ConfigService';
import { LocaleParserRegistry } from '../adapters/locale/registry';
import { isLocaleCode } from './localeCodes';
import { analyzeLocalePath } from './localePath';

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

export interface FrameworkHint {
  workspaceFolder: string;
  frameworks: string[];
}

const DEP_TO_FRAMEWORK: Record<string, string> = {
  'vue-i18n': 'vue-i18n',
  '@nuxtjs/i18n': 'nuxt-i18n',
  'react-i18next': 'react-i18next',
  'next-i18next': 'next-i18next',
  i18next: 'i18next',
  'svelte-i18n': 'svelte-i18n',
  '@angular/localize': 'angular',
  '@ngx-translate/core': 'ngx-translate',
};

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
        );
        results.push(...found);
      }
      return dedupe(results);
    }

    return vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, config.localeFileGlob),
      '**/node_modules/**',
      5000,
    );
  }

  /** 读取 package.json 依赖，推断使用的 i18n 框架（当前仅信息用途）。 */
  async detectFrameworks(): Promise<FrameworkHint[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const hints: FrameworkHint[] = [];
    for (const folder of folders) {
      const pkgs = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/package.json'),
        '**/node_modules/**',
        50,
      );
      const found = new Set<string>();
      for (const pkgUri of pkgs) {
        try {
          const raw = await vscode.workspace.fs.readFile(pkgUri);
          const json = JSON.parse(Buffer.from(raw).toString('utf8'));
          const deps = { ...json.dependencies, ...json.devDependencies };
          for (const dep of Object.keys(deps)) {
            if (DEP_TO_FRAMEWORK[dep]) {
              found.add(DEP_TO_FRAMEWORK[dep]);
            }
          }
        } catch {
          // 忽略无法解析的 package.json
        }
      }
      hints.push({ workspaceFolder: folder.uri.fsPath, frameworks: [...found] });
    }
    return hints;
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
