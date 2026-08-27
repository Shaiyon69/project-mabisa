import { useMemo, useState, type ReactNode } from 'react';
import { BhwLanguageContext, filipino, type BhwLanguageValue, type Language } from './bhwLanguage';

/**
 * The dictionary, the context object and `useBhwLanguage()` live in
 * `bhwLanguage.ts` rather than here, matching the split between
 * `MabisaDataContext.tsx` and `mabisaData.ts`. A file that exports both a
 * component and a plain value loses React Fast Refresh for every consumer of
 * that value, so the provider is the only export in this file.
 */
export function BhwLanguageProvider({ children }: { children: ReactNode }) {
  // The language switch is withdrawn from the UI while the Filipino copy is
  // decided on, so the app is English-only for now. The dictionary, `t()` and
  // `setLanguage` are all still here and still wired — restoring the feature is
  // reading `mabisa-language` again here and putting the toggle back in
  // BHWLayout. Ignoring the stored value is deliberate: a device left on 'fil'
  // would otherwise be stuck there with no control to change it.
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
