// Shared display labels for classifier/STT language codes (mostly ISO 639-1
// plus a few app-specific entries like "hinglish"). Used by both the voice
// language chart and the conversation-languages chart so the two never drift.
export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  mr: 'Marathi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
  or: 'Odia',
  hinglish: 'Hinglish',
};

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}
