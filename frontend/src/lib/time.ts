export function relativeTime(seconds: number, now = Date.now() / 1000): string {
  const diff = Math.max(0, now - seconds);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `há ${Math.floor(diff / 86400)} d`;
  return new Date(seconds * 1000).toLocaleDateString('pt-BR');
}
