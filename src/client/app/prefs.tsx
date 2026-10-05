import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_PREFS, type Prefs } from '../../shared/api';
import { readJson, watchKey, writeJson } from '../lib/storage';

type PrefsContextValue = {
  prefs: Prefs;
  update: (patch: Partial<Prefs>) => void;
};

const PrefsContext = createContext<PrefsContextValue | null>(null);

const resolveTheme = (theme: Prefs['theme']): 'dark' | 'black' | 'light' => {
  if (theme !== 'system') return theme;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  } catch {
    return 'dark';
  }
};

export const applyPrefsToDocument = (prefs: Prefs): void => {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(prefs.theme);
  root.dataset.comments = prefs.commentColors;
  root.dataset.motion = prefs.reduceMotion ? 'reduced' : 'full';
  root.style.setProperty('--ts', String(prefs.textScale));
};

export const loadCachedPrefs = (): Prefs => ({
  ...DEFAULT_PREFS,
  ...readJson<Partial<Prefs>>('prefs', {}),
});

export const PrefsProvider = ({ children }: { children: ReactNode }) => {
  const [prefs, setPrefs] = useState<Prefs>(loadCachedPrefs);

  // Follow changes saved from other Reddit tabs.
  useEffect(
    () =>
      watchKey('prefs', (value) =>
        setPrefs({ ...DEFAULT_PREFS, ...(value as Partial<Prefs>) })
      ),
    []
  );

  useEffect(() => {
    applyPrefsToDocument(prefs);
    if (prefs.theme !== 'system') return;
    let media: MediaQueryList;
    try {
      media = window.matchMedia('(prefers-color-scheme: light)');
    } catch {
      return;
    }
    const onChange = () => applyPrefsToDocument(prefs);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [prefs]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writeJson('prefs', next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return (
    <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
  );
};

export const usePrefs = (): PrefsContextValue => {
  const value = useContext(PrefsContext);
  if (!value) throw new Error('usePrefs must be used inside PrefsProvider');
  return value;
};
