export function redactRemoteMediaUrl(raw) {
  const url = new URL(raw);
  return `${url.protocol}//${url.host}${url.pathname}`;
}
