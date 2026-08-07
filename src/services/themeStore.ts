import { DEFAULT_THEME_MODE, type ThemeMode } from "../app/constants";
import { getSaveData, updateSaveData } from "./saveStore";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}

export function getThemeMode(): ThemeMode {
  const value = getSaveData().settings.themeMode;
  return isThemeMode(value) ? value : DEFAULT_THEME_MODE;
}

export function setThemeMode(mode: ThemeMode): void {
  updateSaveData((data) => {
    data.settings.themeMode = mode;
  });
  applyThemeMode(mode);
}

/** Stamps `data-theme` on the document root so `global.css`'s dark overrides take effect. Called on boot (before first render) and whenever the setting changes. */
export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", mode);
}
