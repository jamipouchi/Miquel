/**
 * Client for the site's Cloudflare AI Search public endpoint.
 * Endpoint id is provisioned in the Cloudflare dashboard (AI Search > miquel-site).
 * Docs: https://developers.cloudflare.com/ai-search/
 */
export const AI_SEARCH_ENDPOINT =
  'https://78a22e35-6a11-4b9a-84fe-1ee03a805a39.search.ai.cloudflare.com';

export interface SearchChunk {
  id: string;
  type: string;
  score: number;
  text: string;
  item: {
    key: string;
    timestamp: number;
    metadata: { title?: string } | null;
  };
}

/** One page worth of hits, chunks deduplicated by URL (ignores trailing slashes). */
export interface PageHit {
  url: string;
  title: string;
  score: number;
  chunks: SearchChunk[];
}

export type ChatEvent =
  | { type: 'sources'; chunks: SearchChunk[] }
  | { type: 'delta'; text: string }
  | { type: 'done' };

/**
 * Streams an answer over the OpenAI-compatible /chat/completions endpoint.
 * The server emits the retrieved source chunks first (event: chunks), then
 * answer deltas, then [DONE]. Parsing follows the SSE framing spec: data
 * lines accumulate until a blank line, multi-line data frames are joined.
 */
export async function* streamChat(
  question: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${AI_SEARCH_ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stream: true,
      messages: [{ role: 'user', content: question }],
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let eventType = '';

  function* dispatch(): Generator<ChatEvent> {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    dataLines = [];
    const type = eventType;
    eventType = '';
    if (data === '[DONE]') {
      yield { type: 'done' };
      return;
    }
    try {
      const parsed = JSON.parse(data);
      if (type === 'chunks') {
        yield { type: 'sources', chunks: parsed as SearchChunk[] };
      } else {
        const text = parsed.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text.length > 0) {
          yield { type: 'delta', text };
        }
      }
    } catch {
      // ignore keep-alive or partial frames
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 500_000) throw new Error('stream exceeded size limit');

      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);

        if (line === '') {
          yield* dispatch();
        } else if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
        // SSE comments (':…') and unknown fields are ignored.
      }
    }
    // Server closed without a trailing newline: process the remainder.
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) {
      dataLines.push(buffer.slice(5).trimStart());
    }
    yield* dispatch();
    yield { type: 'done' };
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Normalizes a page URL so `/foo` and `/foo/` group together. */
export function pageKey(url: string): string {
  let path: string;
  try {
    // Absolute base neutralizes schemes: 'javascript:…' and '//host/…' cannot
    // produce a link target outside this origin.
    path = new URL(url, 'https://miquelpuigturon.com').pathname;
  } catch {
    path = '/';
  }
  if (!path.startsWith('/') || path.startsWith('//')) path = '/';
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path;
}

/** Groups chunks into one entry per page, best-scored chunk first. */
export function groupByPage(chunks: SearchChunk[]): PageHit[] {
  const byKey = new Map<string, PageHit>();
  for (const chunk of chunks) {
    const key = pageKey(chunk.item.key);
    const existing = byKey.get(key);
    if (existing) {
      existing.chunks.push(chunk);
      existing.score = Math.max(existing.score, chunk.score);
    } else {
      byKey.set(key, {
        url: chunk.item.key,
        title: chunk.item.metadata?.title ?? '',
        score: chunk.score,
        chunks: [chunk],
      });
    }
  }
  const hits = [...byKey.values()];
  hits.sort((a, b) => b.score - a.score);
  for (const hit of hits) {
    if (!hit.title) hit.title = titleFromChunks(hit.chunks) ?? humanizePath(hit.url);
  }
  return hits;
}

/**
 * Derives a page title from its first markdown heading. Every page's
 * .page-body starts with its h1, so the page's opening chunk carries it.
 * Used when the index does not provide a title (sitemap crawl mode).
 */
export function titleFromChunks(chunks: SearchChunk[]): string | null {
  for (const chunk of chunks) {
    const match = chunk.text.match(/^#\s+(.+?)\s*$/m);
    if (match) return match[1].trim();
  }
  return null;
}

/** `/humanity/temporal/worker-configuration/` -> `Worker configuration`. */
export function humanizePath(url: string): string {
  const key = pageKey(url);
  if (key === '/') return 'Home';
  const last = key.split('/').filter(Boolean).pop() ?? key;
  const spaced = last.replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
