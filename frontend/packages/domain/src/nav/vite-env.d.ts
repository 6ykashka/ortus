// W1.20 · Возможности Vite/Vitest, которыми пользуются тесты навигации (у пакета нет типов vite).
declare module '*?raw' {
  const text: string;
  export default text;
}

interface ImportMeta {
  glob<T = unknown>(pattern: string, options?: { eager?: boolean }): Record<string, T>;
}
