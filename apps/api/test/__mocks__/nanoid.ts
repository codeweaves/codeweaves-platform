export function customAlphabet(_alphabet: string, size: number) {
  return () => 'A'.repeat(size);
}

export function nanoid(size = 21) {
  return 'A'.repeat(size);
}
