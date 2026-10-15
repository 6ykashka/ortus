// Адрес API для прокси Vite `/api` (план v2 §3.6): ORTUS_API_ORIGIN (харнесс W0.05), иначе HTTP_ADDR агента
// (127.0.0.1:(8100 + slot)), иначе стенд интегратора 127.0.0.1:8080.
export function apiOrigin(env: Record<string, string | undefined>): string {
  const origin = env.ORTUS_API_ORIGIN?.trim();
  if (origin) return origin.replace(/\/+$/, '');
  return `http://${env.HTTP_ADDR?.trim() || '127.0.0.1:8080'}`;
}
