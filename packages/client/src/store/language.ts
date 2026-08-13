import { defineStore } from "pinia";
import { ref } from "vue";

export type Locale = "zh-CN" | "en-US";

const LANGUAGE_STORAGE_KEY = "workgaga:language";

const getInitialLocale = (): Locale => {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en-US") return stored;
  } catch {
    return "zh-CN";
  }

  return typeof navigator !== "undefined" && navigator.language.startsWith("en")
    ? "en-US"
    : "zh-CN";
};

export const useLanguageStore = defineStore("language", () => {
  const locale = ref<Locale>(getInitialLocale());

  const setLocale = (nextLocale: Locale): void => {
    locale.value = nextLocale;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale);
    } catch {
      return;
    }
    if (typeof document !== "undefined") document.documentElement.lang = nextLocale;
  };

  const toggleLocale = (): void => {
    setLocale(locale.value === "zh-CN" ? "en-US" : "zh-CN");
  };

  return { locale, setLocale, toggleLocale };
});
