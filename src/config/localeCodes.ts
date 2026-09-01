/**
 * 判断一个字符串是否像「语言 / 区域代码」。
 *
 * 单纯用 `/^[a-z]{2,3}(-[A-Z]{2})?$/` 太宽：`src` / `lib` / `app` / `web` / `api`
 * 这类目录名也会被当成 locale，导致 i18n 的入口文件被误当语言文件。
 * 因此对「裸语言子标签」用 ISO 639-1 白名单收紧；带区域 / 脚本的形式（zh-CN、pt-BR、
 * zh-Hans）结构性即可判定。
 */

// ISO 639-1 常见语言代码（够覆盖前端项目里会出现的语种）
const ISO_639_1 = new Set(
  (
    'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy ' +
    'da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu ' +
    'hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb ' +
    'lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om ' +
    'or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ' +
    'ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
  ).split(' '),
);

const REGIONED_RE = /^[a-z]{2,3}[-_](?:[a-z]{2}|[a-z]{4}|\d{3})$/i;
const SCRIPT_REGION_RE = /^[a-z]{2,3}[-_][a-z]{4}[-_][a-z]{2}$/i;

/** 该 token 是否可作为 locale 代码。 */
export function isLocaleCode(token: string): boolean {
  const t = token.trim();
  if (!t) {
    return false;
  }
  if (REGIONED_RE.test(t) || SCRIPT_REGION_RE.test(t)) {
    return true;
  }
  // 裸子标签：必须是已知语言代码
  return ISO_639_1.has(t.toLowerCase());
}

/** 归一化：`zh_cn` / `zh-cn` → `zh-CN`，`pt_br` → `pt-BR`，裸码转小写。 */
export function normalizeLocale(code: string): string {
  const segs = code.split(/[-_]/);
  if (segs.length === 1) {
    return segs[0].toLowerCase();
  }
  const [lang, ...rest] = segs;
  return `${lang.toLowerCase()}-${rest.map((s) => s.toUpperCase()).join('-')}`;
}
