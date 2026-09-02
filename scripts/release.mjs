// 一条命令完成：升版本号 → 打包 → 发布到 VS Code Marketplace + GitHub Releases（可选 Open VSX）。
//
// 用法：
//   node scripts/release.mjs                # 补丁号 +1（1.0.2 → 1.0.3）
//   node scripts/release.mjs patch|minor|major
//   node scripts/release.mjs 1.2.0          # 指定版本号（必须比当前大）
//
// 常用开关：
//   --dry-run          只演练，不改文件、不推送、不发布
//   --no-marketplace   跳过 VS Code Marketplace
//   --no-github        跳过 GitHub Release
//   --ovsx             额外发布到 Open VSX（默认不发）
//   --no-git           不 commit / tag / push（只打包发布）
//   --publish-only    不升版本 / 不动 git，只把当前版本补发到之前跳过或失败的平台
//   --skip-checks      跳过 typecheck + lint + build 预检
//   --yes              不再交互确认
//
// 需要的凭据（缺哪个就跳过哪个平台，并给出提示）：
//   Marketplace : 环境变量 VSCE_PAT
//   Open VSX    : 环境变量 OVSX_PAT
//   GitHub      : 本机已 `gh auth login`（无需 token）

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

// ── 参数解析 ───────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));

const dryRun = flags.has('--dry-run');
const doMarketplace = !flags.has('--no-marketplace');
const doGithub = !flags.has('--no-github');
const doOvsx = flags.has('--ovsx');
const doGit = !flags.has('--no-git');
const skipChecks = flags.has('--skip-checks');
const assumeYes = flags.has('--yes');
// 只补发：跳过版本号计算与 git 操作，把 package.json 当前版本发到还没发的平台
const publishOnly = flags.has('--publish-only');

// ── 计算新版本号 ───────────────────────────────────────────
const current = pkg.version;
const parts = current.split('.').map(Number);
if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
  fail(`package.json 里的 version 不是合法 x.y.z：${current}`);
}
const [maj, min, pat] = parts;

let next;
if (publishOnly) {
  next = current; // 只补发，不动版本号
} else {
  const bumpArg = positional[0] ?? 'patch';
  if (bumpArg === 'patch') next = `${maj}.${min}.${pat + 1}`;
  else if (bumpArg === 'minor') next = `${maj}.${min + 1}.0`;
  else if (bumpArg === 'major') next = `${maj + 1}.0.0`;
  else if (/^\d+\.\d+\.\d+$/.test(bumpArg)) next = bumpArg;
  else fail(`版本参数只接受 patch / minor / major / x.y.z，收到：${bumpArg}`);

  if (cmpVersion(next, current) <= 0) {
    fail(`新版本号 ${next} 必须大于当前 ${current}`);
  }
}
const tag = `v${next}`;

// ── 前置检查：工作区干净（补发模式允许带未提交改动）──────
if (existsSync(join(root, '.git')) && !dryRun && !publishOnly) {
  const dirty = run('git', ['status', '--porcelain'], { capture: true }).trim();
  if (dirty) {
    fail('工作区有未提交改动，请先提交或 stash：\n' + dirty);
  }
}

const changelogNote = extractChangelogSection(next);

console.log('──────────────────────────────────────────');
console.log(
  publishOnly ? `  补发 ${pkg.name}   ${current}（不升版本、不动 git）` : `  发布 ${pkg.name}   ${current} → ${next}`,
);
console.log(
  `  目标：${[doMarketplace && 'Marketplace', doGithub && 'GitHub', doOvsx && 'Open VSX']
    .filter(Boolean)
    .join(' + ') || '（无）'}`,
);
console.log(
  `  凭据：VSCE_PAT ${envMark('VSCE_PAT')}   OVSX_PAT ${envMark('OVSX_PAT')}   gh ${ghState() === 'ok' ? '✔' : '—'}`,
);
if (!changelogNote) {
  console.log(`  ⚠ CHANGELOG.md 没有 "## ${next}" 小节，GitHub 发布说明将由 git 提交自动生成`);
}
if (dryRun) console.log('  [dry-run] 只演练，不会真正改动 / 发布');
console.log('──────────────────────────────────────────');

if (!assumeYes && !dryRun) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question('确认继续？(y/N) ')).trim().toLowerCase();
  rl.close();
  if (ans !== 'y' && ans !== 'yes') process.exit(0);
}

// ── 预检：类型 / lint / 构建 ───────────────────────────────
if (!skipChecks) {
  step('类型检查 + lint + 构建');
  runNodeBin('node_modules/typescript/bin/tsc', ['--noEmit', '-p', 'tsconfig.json']);
  runNodeBin('node_modules/eslint/bin/eslint.js', ['src', '--ext', 'ts']);
  run('node', ['esbuild.js', '--production']);
}

// ── 写版本号（补发模式不改）───────────────────────────────
if (!publishOnly) {
  step(`写入 version = ${next}`);
  if (!dryRun) {
    pkg.version = next;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

// ── 打包（补发模式：已有同版本 vsix 就直接复用）────────────
const vsixName = `${pkg.name}-${next}.vsix`;
const vsixPath = join(root, vsixName);
if (publishOnly && existsSync(vsixPath)) {
  step(`复用已有产物 ${vsixName}`);
} else {
  step('vsce package');
  for (const f of readdirSync(root).filter((f) => f.endsWith('.vsix'))) {
    if (!dryRun) unlinkSync(join(root, f));
  }
  if (!dryRun) {
    run('node', ['./node_modules/@vscode/vsce/vsce', 'package', '--no-dependencies', '-o', vsixPath]);
  } else {
    console.log(`  [dry-run] 会生成 ${vsixName}`);
  }
}

// ── git 提交 + tag + push（补发模式跳过）──────────────────
if (doGit && !dryRun && !publishOnly) {
  step(`git commit + tag ${tag} + push`);
  run('git', ['add', 'package.json', 'CHANGELOG.md']);
  run('git', ['commit', '-m', `chore: release ${tag}`]);
  run('git', ['tag', tag]);
  run('git', ['push']);
  run('git', ['push', 'origin', tag]);
}

// ── 发布 ───────────────────────────────────────────────────
const results = [];

if (doMarketplace) {
  step('发布到 VS Code Marketplace');
  if (!process.env.VSCE_PAT) {
    results.push(['Marketplace', 'skip', '缺 VSCE_PAT 环境变量']);
  } else if (dryRun) {
    results.push(['Marketplace', 'dry-run', vsixName]);
  } else {
    try {
      run('node', [
        './node_modules/@vscode/vsce/vsce',
        'publish',
        '--no-dependencies',
        '--skip-duplicate',
        '--packagePath',
        vsixPath,
      ]);
      results.push([
        'Marketplace',
        'ok',
        `https://marketplace.visualstudio.com/items?itemName=${pkg.publisher}.${pkg.name}`,
      ]);
    } catch (e) {
      results.push(['Marketplace', 'fail', firstLine(e)]);
    }
  }
}

if (doOvsx) {
  step('发布到 Open VSX');
  if (!process.env.OVSX_PAT) {
    results.push(['Open VSX', 'skip', '缺 OVSX_PAT 环境变量']);
  } else if (dryRun) {
    results.push(['Open VSX', 'dry-run', vsixName]);
  } else {
    try {
      run('npx', ['ovsx', 'publish', vsixPath], { shell: true, env: { ...process.env, OVSX_PAT: process.env.OVSX_PAT } });
      results.push(['Open VSX', 'ok', `https://open-vsx.org/extension/${pkg.publisher}/${pkg.name}`]);
    } catch (e) {
      results.push(['Open VSX', 'fail', firstLine(e)]);
    }
  }
}

if (doGithub) {
  step(`发布 GitHub Release ${tag}`);
  if (ghState() !== 'ok') {
    results.push(['GitHub', 'skip', 'gh 未安装或未登录']);
  } else if (dryRun) {
    results.push(['GitHub', 'dry-run', vsixName]);
  } else {
    try {
      const repoArg = repoSlug();
      const releaseExists = tryRun('gh', ['release', 'view', tag, ...(repoArg ? ['--repo', repoArg] : [])]);
      if (releaseExists) {
        // 补发场景：release 已存在，只更新 vsix 附件
        run('gh', ['release', 'upload', tag, vsixPath, '--clobber', ...(repoArg ? ['--repo', repoArg] : [])]);
      } else {
        const title = `${pkg.displayName || pkg.name} ${tag}`;
        const args = ['release', 'create', tag, vsixPath, '--title', title];
        if (changelogNote) args.push('--notes', changelogNote);
        else args.push('--generate-notes');
        if (repoArg) args.push('--repo', repoArg);
        run('gh', args);
      }
      const repoUrl = (pkg.repository?.url || '').replace(/\.git$/, '');
      results.push(['GitHub', 'ok', `${repoUrl}/releases/tag/${tag}`]);
    } catch (e) {
      results.push(['GitHub', 'fail', firstLine(e)]);
    }
  }
}

// ── 汇总 ───────────────────────────────────────────────────
console.log('\n──────────────── 结果 ────────────────');
for (const [platform, state, detail] of results) {
  const mark = { ok: '✔', fail: '✗', skip: '—', 'dry-run': '·' }[state] ?? '?';
  console.log(`  ${mark} ${platform.padEnd(12)} ${detail}`);
}
console.log(`\n本地产物：${vsixName}`);
if (results.some((r) => r[1] === 'fail')) process.exit(1);

// ── 工具函数 ───────────────────────────────────────────────
function step(msg) {
  console.log(`\n▶ ${msg}`);
}
function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
function run(cmd, args, opts = {}) {
  // 默认不经过 shell：Windows 下 shell:true 会把 args 拼成字符串且不转义，
  // 导致带空格 / 特殊字符的参数（提交信息、--notes 正文）被拆散。
  // git / gh / node 都是真实可执行文件，直接 spawn 即可。
  return (
    execFileSync(cmd, args, {
      cwd: root,
      stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      encoding: 'utf8',
      shell: opts.shell === true,
      env: opts.env ?? process.env,
    }) ?? ''
  );
}

// 用 node 直接跑 node_modules 里的 CLI，绕开 Windows 上的 npx.cmd（.cmd 需要 shell）。
function runNodeBin(relBinPath, args) {
  run('node', [join(root, relBinPath), ...args]);
}
/** 静默执行，成功返回 true，失败返回 false（用于探测型命令）。 */
function tryRun(cmd, args) {
  try {
    execFileSync(cmd, args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
/** owner/repo，取自 package.json 的 repository.url。 */
function repoSlug() {
  const m = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? '');
  return m ? m[1] : '';
}
function cmpVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
function envMark(name) {
  return process.env[name] ? '✔' : '—';
}
function ghState() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
    return 'ok';
  } catch {
    return '—';
  }
}
function firstLine(err) {
  return String(err?.message ?? err).split('\n')[0];
}
function extractChangelogSection(version) {
  const p = join(root, 'CHANGELOG.md');
  if (!existsSync(p)) return '';
  const text = readFileSync(p, 'utf8');
  const re = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?.*$`, 'm');
  const m = re.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const nextHeading = rest.search(/^##\s+/m);
  return rest.slice(0, nextHeading === -1 ? undefined : nextHeading).trim();
}
