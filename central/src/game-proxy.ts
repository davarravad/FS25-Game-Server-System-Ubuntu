import {decodeHTMLAttribute} from 'entities';

/** Rewrite only this game's origin, never unrelated external links. */
export function gameUrl(value: string, publicOrigin: string, upstreamOrigin: string): string {
  if (!/^(?:https?:)?\/\//i.test(value)) return value;
  try {
    const source = new URL(upstreamOrigin);
    const target = new URL(value, publicOrigin);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return value;
    const ip = target.hostname.split('.').map(Number);
    const privateIP = ip.length === 4 && ip.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
      && (ip[0] === 10 || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] === 192 && ip[1] === 168) || ip[0] === 127);
    // Multi-network containers can advertise a different private interface than nginx uses.
    // Restrict that fallback to GIANTS feeds on this game's exact HTTP port.
    const localFeed = privateIP && target.port === source.port && target.pathname.startsWith('/feed/');
    const publicHost = target.hostname === new URL(publicOrigin).hostname;
    if (target.origin !== source.origin && !localFeed && !publicHost) return value;
    return publicOrigin + target.pathname + target.search + target.hash;
  } catch { return value; }
}

export function rewriteGameHtml(response: Response, publicOrigin: string, upstreamOrigin: string): Response {
  const headers = new Headers(response.headers);
  // Representation length and encoding no longer describe the transformed body.
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  headers.delete('ETag');
  return new HTMLRewriter().on('[href], [src], [action], [poster], input[type="url"][value]', {
    element(element) {
      for (const name of ['href', 'src', 'action', 'poster', 'value']) {
        const before = element.getAttribute(name);
        if (!before) continue;
        const decoded = decodeHTMLAttribute(before);
        const after = gameUrl(decoded, publicOrigin, upstreamOrigin);
        if (after === decoded) continue;
        element.setAttribute(name, after);
        // GIANTS exposes feed URLs as link labels as well as hrefs. Set escaped text,
        // so copied links use HTTPS too, without buffering HTML or parsing text chunks.
        if (element.tagName === 'a' && name === 'href' && new URL(after).pathname.startsWith('/feed/')) {
          element.setInnerContent(after);
        }
      }
    }
  }).transform(new Response(response.body, {status:response.status, headers}));
}
