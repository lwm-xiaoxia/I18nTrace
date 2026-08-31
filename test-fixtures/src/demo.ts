import { useI18n } from 'vue-i18n';

declare function t(key: string, opts?: Record<string, unknown>): string;
declare const i18n: { t(key: string): string; global: { t(key: string): string } };

export function demo(): void {
  // 静态 key —— 应显示气泡
  console.log(t('user.name'));
  console.log(t('user.deleteSuccess'));
  console.log(i18n.t('common.ok'));
  console.log(i18n.global.t('common.cancel'));

  const { t: $t } = useI18n();
  console.log($t('user.email', { escape: false }));

  // 动态 key —— 不应显示气泡
  const part = 'name';
  console.log(t(`user.${part}`));
  console.log(t('user.' + part));

  // 未知 key —— 显示 ⚠️
  console.log(t('user.unknownKey'));
}
