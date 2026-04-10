'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { type Locale, type TranslationKey, translations } from '@/lib/i18n';

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const LOCALE_STORAGE_KEY = 'locale';
const LOCALE_CHANGE_EVENT = 'job-search:locale-change';

const LocaleContext = createContext<LocaleContextType>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => translations.en[key],
});

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') {
    return 'en';
  }

  const savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return savedLocale === 'ko' ? 'ko' : 'en';
}

function subscribeLocaleStore(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY) {
      onStoreChange();
    }
  };
  const handleLocaleChange = () => onStoreChange();

  window.addEventListener('storage', handleStorage);
  window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
  };
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore<Locale>(subscribeLocaleStore, readStoredLocale, () => 'en');

  const setLocale = useCallback((nextLocale: Locale) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
  }, []);

  const t = useCallback((key: TranslationKey) => {
    return translations[locale][key];
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
