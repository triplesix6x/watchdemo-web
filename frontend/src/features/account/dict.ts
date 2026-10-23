// The cabinet's page dictionary and styles.
import { useDict } from '../../i18n'
import ru from '../../i18n/pages/account.ru'
import en from '../../i18n/pages/account.en'
import './account.css'

export const accountDicts = { ru, en }
export const useAccountDict = () => useDict(accountDicts)
