import { useMemo, useState, type ReactNode } from 'react';
import { BhwLanguageContext, filipino, type BhwLanguageValue, type Language } from './bhwLanguage';

/** Only the provider lives here — the context, dictionary and hook moved to `bhwLanguage.ts` for Fast Refresh. */
export function BhwLanguageProvider({ children }: { children: ReactNode }) {
  // App is English-only for now (the toggle is withdrawn from the UI, not removed
  // — see BHWLayout). The stored value is deliberately ignored so a device left on 'fil' isn't stuck with no control.
  const [language, setLanguageState] = useState<Language>('en');

  const value = useMemo<BhwLanguageValue>(() => ({
    language,
    setLanguage(nextLanguage) {
      localStorage.setItem('mabisa-language', nextLanguage);
      setLanguageState(nextLanguage);
    },
    t(text) {
      return language === 'fil' ? filipino[text] ?? text : text;
    },
    isFilipino: language === 'fil',
  }), [language]);

  return <BhwLanguageContext.Provider value={value}>{children}</BhwLanguageContext.Provider>;
}
