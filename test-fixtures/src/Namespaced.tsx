import { useTranslation } from 'react-i18next';

export function Namespaced(): JSX.Element {
  // useTranslation 声明的默认命名空间，代码里只写裸 key
  const { t } = useTranslation('common');
  return (
    <div>
      <span>{t('save')}</span>
      <span>{t('nested.deep')}</span>
      {/* 显式命名空间前缀 */}
      <span>{t('home:title')}</span>
      {/* 通过 options 指定命名空间 */}
      <span>{t('pay', { ns: 'checkout' })}</span>
      {/* 自然语句当 key，不能被空格切碎 */}
      <span>{t('Save changes')}</span>
      {/* 注释里的调用不应出气泡：t('common:cancel') */}
    </div>
  );
}
