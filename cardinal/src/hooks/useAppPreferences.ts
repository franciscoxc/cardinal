import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { i18n as I18nInstance } from 'i18next';
import { OPEN_PREFERENCES_EVENT } from '../constants/appEvents';
import { getBrowserLanguage } from '../i18n/config';
import { applyThemePreference, persistThemePreference } from '../theme';
import { setTrayEnabled } from '../tray';
import { getStoredTrayIconEnabled, persistTrayIconEnabled } from '../trayIconPreference';
import { useStoredState } from './useStoredState';
import { setWatchConfig } from '../utils/watchConfig';
import type { FullDiskAccessStatus } from './useFullDiskAccessPermission';
import { useIgnorePaths } from './useIgnorePaths';
import { useIncludePaths } from './useIncludePaths';
import { useWatchRoot } from './useWatchRoot';

export const FOLDER_SIZES_STORAGE_KEY = 'cardinal.preferences.folderSizes';
export const DEEP_FOLDER_SIZES_STORAGE_KEY = 'cardinal.preferences.deepFolderSizes';
export const FOLDERS_FIRST_STORAGE_KEY = 'cardinal.preferences.foldersFirst';

/// Reads the folders-first preference straight from storage.
///
/// ponytail-keep: a direct read rather than a prop. The search hook runs before this one in the
/// tree, so it cannot receive the value — and it needs it at the moment it calls the backend, not
/// at render. The setter writes synchronously, so a refresh triggered right after a toggle already
/// sees the new value.
export const readFoldersFirstPreference = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    return window.localStorage.getItem(FOLDERS_FIRST_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

type WatchConfigChangePayload = {
  watchRoot: string;
  ignorePaths: string[];
  includePaths: string[];
};

type UseAppPreferencesOptions = {
  fullDiskAccessStatus: FullDiskAccessStatus;
  isCheckingFullDiskAccess: boolean;
  refreshSearchResults: () => void;
  i18n: Pick<I18nInstance, 'changeLanguage'>;
};

type UseAppPreferencesResult = {
  isPreferencesOpen: boolean;
  closePreferences: () => void;
  trayIconEnabled: boolean;
  folderSizesEnabled: boolean;
  setFolderSizesEnabled: (enabled: boolean) => void;
  foldersFirstEnabled: boolean;
  setFoldersFirstEnabled: (enabled: boolean) => void;
  deepFolderSizesEnabled: boolean;
  setDeepFolderSizesEnabled: (enabled: boolean) => void;
  setTrayIconEnabled: (enabled: boolean) => void;
  watchRoot: string;
  defaultWatchRoot: string;
  ignorePaths: string[];
  defaultIgnorePaths: string[];
  includePaths: string[];
  defaultIncludePaths: string[];
  preferencesResetToken: number;
  handleWatchConfigChange: (next: WatchConfigChangePayload) => void;
  handleResetPreferences: () => void;
};

const areStringArraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * Manages app preferences including watch config, tray, theme, language, and overlay state.
 * Provides actions for updating watch settings and resetting preferences to defaults.
 */
export function useAppPreferences({
  fullDiskAccessStatus,
  isCheckingFullDiskAccess,
  refreshSearchResults,
  i18n,
}: UseAppPreferencesOptions): UseAppPreferencesResult {
  const { watchRoot, setWatchRoot, defaultWatchRoot } = useWatchRoot();
  const { ignorePaths, setIgnorePaths, defaultIgnorePaths } = useIgnorePaths();
  const { includePaths, setIncludePaths, defaultIncludePaths } = useIncludePaths();
  const logicStartedRef = useRef(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [trayIconEnabled, setTrayIconEnabled] = useState<boolean>(() => getStoredTrayIconEnabled());
  // Off by default: summing a subtree per visible folder is work the app never used to do, and
  // nobody should pay for it without asking.
  const [folderSizesEnabled, setFolderSizesEnabled] = useStoredState<boolean>({
    key: FOLDER_SIZES_STORAGE_KEY,
    defaultValue: false,
    read: (raw) => raw === 'true',
    write: (value) => (value ? 'true' : 'false'),
    readErrorMessage: 'Failed to read folder size preference',
    writeErrorMessage: 'Failed to persist folder size preference',
  });
  // Off by default and gated on the one above: this is the walk of the very directories that were
  // excluded to save battery, so it is opt-in twice over.
  const [deepFolderSizesEnabled, setDeepFolderSizesEnabled] = useStoredState<boolean>({
    key: DEEP_FOLDER_SIZES_STORAGE_KEY,
    defaultValue: false,
    read: (raw) => raw === 'true',
    write: (value) => (value ? 'true' : 'false'),
    readErrorMessage: 'Failed to read deep folder size preference',
    writeErrorMessage: 'Failed to persist deep folder size preference',
  });
  // On by default, unlike the folder-size pair above: this only changes the order rows come back
  // in, costs a partition of a list already in memory, and is what people expect from a file list.
  const [foldersFirstEnabled, setFoldersFirstEnabled] = useStoredState<boolean>({
    key: FOLDERS_FIRST_STORAGE_KEY,
    defaultValue: true,
    read: (raw) => raw !== 'false',
    write: (value) => (value ? 'true' : 'false'),
    readErrorMessage: 'Failed to read folders-first preference',
    writeErrorMessage: 'Failed to persist folders-first preference',
  });
  const [preferencesResetToken, setPreferencesResetToken] = useState(0);

  useEffect(() => {
    persistTrayIconEnabled(trayIconEnabled);
    void setTrayEnabled(trayIconEnabled);
  }, [trayIconEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOpenPreferences = () => setIsPreferencesOpen(true);
    window.addEventListener(OPEN_PREFERENCES_EVENT, handleOpenPreferences);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, handleOpenPreferences);
  }, []);

  useEffect(() => {
    if (isCheckingFullDiskAccess) {
      return;
    }
    if (fullDiskAccessStatus !== 'granted') {
      return;
    }
    if (!watchRoot) {
      return;
    }
    if (logicStartedRef.current) {
      return;
    }

    logicStartedRef.current = true;
    void invoke('start_logic', { watchRoot, ignorePaths, includePaths });
  }, [fullDiskAccessStatus, ignorePaths, includePaths, isCheckingFullDiskAccess, watchRoot]);

  const applyWatchConfig = useCallback(
    (nextWatchRoot: string, nextIgnorePaths: string[], nextIncludePaths: string[]) => {
      const watchConfigChanged =
        nextWatchRoot !== watchRoot ||
        !areStringArraysEqual(nextIgnorePaths, ignorePaths) ||
        !areStringArraysEqual(nextIncludePaths, includePaths);

      if (!watchConfigChanged) {
        return;
      }

      setWatchRoot(nextWatchRoot);
      setIgnorePaths(nextIgnorePaths);
      setIncludePaths(nextIncludePaths);
      if (logicStartedRef.current && nextWatchRoot) {
        void setWatchConfig({
          watchRoot: nextWatchRoot,
          ignorePaths: nextIgnorePaths,
          includePaths: nextIncludePaths,
        });
      }
      refreshSearchResults();
    },
    [
      ignorePaths,
      includePaths,
      refreshSearchResults,
      setIgnorePaths,
      setIncludePaths,
      setWatchRoot,
      watchRoot,
    ],
  );

  const handleWatchConfigChange = useCallback(
    (next: WatchConfigChangePayload) => {
      applyWatchConfig(next.watchRoot, next.ignorePaths, next.includePaths);
    },
    [applyWatchConfig],
  );

  const handleResetPreferences = useCallback(() => {
    setTrayIconEnabled(false);
    setFoldersFirstEnabled(true);
    persistThemePreference('system');
    applyThemePreference('system');
    const nextLanguage = getBrowserLanguage();
    void i18n.changeLanguage(nextLanguage);
    setPreferencesResetToken((token) => token + 1);
  }, [i18n, setFoldersFirstEnabled]);

  const closePreferences = useCallback(() => setIsPreferencesOpen(false), []);

  return {
    isPreferencesOpen,
    closePreferences,
    trayIconEnabled,
    folderSizesEnabled,
    setFolderSizesEnabled,
    foldersFirstEnabled,
    setFoldersFirstEnabled,
    deepFolderSizesEnabled,
    setDeepFolderSizesEnabled,
    setTrayIconEnabled,
    watchRoot,
    defaultWatchRoot,
    ignorePaths,
    defaultIgnorePaths,
    includePaths,
    defaultIncludePaths,
    preferencesResetToken,
    handleWatchConfigChange,
    handleResetPreferences,
  };
}
