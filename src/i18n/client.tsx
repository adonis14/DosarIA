"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "./config";
import type { Dictionary } from "./dictionaries/en";

type ClientI18n = {
  locale: Locale;
  messages: Dictionary["client"];
  roles: Dictionary["labels"]["roles"];
};

const I18nContext = createContext<ClientI18n | null>(null);

/** Supplies the (small, string-only) client message set chosen on the server. */
export function I18nProvider({ value, children }: { value: ClientI18n; children: ReactNode }) {
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): ClientI18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
