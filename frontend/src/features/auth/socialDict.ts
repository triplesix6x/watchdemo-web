import { useLocale } from '../../i18n'

const ru = {
  continue: 'Продолжить через', link: 'Привязать', verify: 'Подтвердить через', linked: 'Привязан',
  unavailable: 'Сервис не настроен. Используйте другой способ входа.', failed: 'Не удалось завершить вход. Начните заново.',
  desktop: 'Вход в приложение WatchDemo', desktopLead: 'Продолжайте, только если вы начали вход в приложении WatchDemo на своём компьютере. Сайт не будет авторизован.',
  desktopApprove: 'Войти в приложение на компьютере', desktopDone: 'Вход разрешён. Вернитесь в приложение WatchDemo.',
  title: 'Завершение входа', username: 'Имя пользователя', choose: 'Выберите уникальное имя пользователя. Учётная запись будет создана только после этого шага.',
  create: 'Создать учётную запись', retry: 'Вернуться ко входу', providers: 'Связанные аккаунты',
  connections: 'Привязка доступна только из вашей учётной записи. Перенос и объединение аккаунтов не поддерживаются.',
  credentials: 'Почта и пароль', lead: 'Почта и пароль необязательны. Сначала подтвердите почту, затем задайте пароль. Для каждого изменения повторно подтвердите вход через связанный сервис.',
  ready: 'Вход подтверждён на 5 минут для одного действия.', email: 'Новая почта', send: 'Отправить подтверждение',
  sent: 'Письмо отправлено. Откройте ссылку и вернитесь в настройки.', password: 'Новый пароль', save: 'Задать пароль',
  saved: 'Пароль задан. Теперь можно входить с почтой и паролем.', requireEmail: 'Сначала добавьте и подтвердите почту.',
  delete: 'Удалить аккаунт', usernameConfirm: 'Введите имя пользователя для удаления', deleteLead: 'Удаление необратимо. Сначала подтвердите вход через связанный сервис.',
  none: 'Не добавлена', verifyFirst: 'Сначала подтвердите вход через связанный сервис.', done: 'Сервис привязан.', loading: 'Загрузка…',
}
const en: typeof ru = {
  continue: 'Continue with', link: 'Link', verify: 'Verify with', linked: 'Linked',
  unavailable: 'Provider is not configured. Use another sign-in method.', failed: 'Sign-in could not be completed. Please start again.',
  desktop: 'Sign in to WatchDemo desktop', desktopLead: 'Continue only if you started sign-in in the WatchDemo app on your own computer. This will not sign you into the website.',
  desktopApprove: 'Sign in to the desktop app', desktopDone: 'Sign-in approved. Return to the WatchDemo desktop app.',
  title: 'Complete sign-in', username: 'Username', choose: 'Choose a unique username. Your account is created only after this step.',
  create: 'Create account', retry: 'Back to sign-in', providers: 'Connected accounts',
  connections: 'Link providers only from your account. Account transfers and merging are not supported.',
  credentials: 'Email and password', lead: 'Email and password are optional. Confirm your email before setting a password. Verify with a linked provider again for each change.',
  ready: 'Verified for one action within 5 minutes.', email: 'New email', send: 'Send confirmation',
  sent: 'Confirmation sent. Open the email link, then return to settings.', password: 'New password', save: 'Set password',
  saved: 'Password set. You can now sign in using email and password.', requireEmail: 'Add and confirm an email first.',
  delete: 'Delete account', usernameConfirm: 'Type your username to delete the account', deleteLead: 'Deletion is irreversible. First verify with a linked provider.',
  none: 'Not added', verifyFirst: 'First verify with a linked provider.', done: 'Provider linked.', loading: 'Loading…',
}
export const useSocialDict = () => useLocale() === 'en' ? en : ru
