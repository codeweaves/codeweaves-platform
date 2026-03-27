/** Only allow https URLs — blocks javascript:, data:, http:// etc. */
export function isSafeUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}
