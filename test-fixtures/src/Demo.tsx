import { useTranslation } from 'react-i18next';

export function Demo(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <h1>{t('user.name')}</h1>
      <span title={t('user.email')}>{t('user.deleteSuccess')}</span>
      <button>{t('common.cancel')}</button>
    </div>
  );
}
