import { realpathSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import express, { type RequestHandler } from 'express';

const reserved = new Set(['auth', 'account', 'api-keys', 'v1', 'config', 'health', 'provider']);
const inside = (root: string, path: string) => {
  const child = relative(root, path);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};
const notFound = () => Object.assign(new Error('Not found'), { status: 404 });

/** Validate before chain initialization/recovery; an explicit broken export must fail startup. */
export function resolveWebStaticDir(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!value || !isAbsolute(value) || value.includes('\0')) throw new Error('WEB_STATIC_DIR must be an absolute directory containing the exported index.html');
  try {
    const root = realpathSync(value);
    const index = realpathSync(join(root, 'index.html'));
    if (!statSync(root).isDirectory() || !inside(root, index) || !statSync(index).isFile()) throw new Error();
    return root;
  } catch {
    throw new Error('WEB_STATIC_DIR must be an existing export directory with an index.html inside it');
  }
}

/** Serve only exported files. API misses never turn into HTML or an SPA fallback. */
export function staticWeb(directory: string): RequestHandler {
  const root = resolveWebStaticDir(directory)!;
  const serve = express.static(root, { dotfiles: 'deny', index: 'index.html', extensions: false, fallthrough: false, redirect: true, cacheControl: false });
  return (req, res, next) => {
    void (async () => {
      let path: string;
      try { path = decodeURIComponent(req.path); }
      catch { throw Object.assign(new Error('Malformed URL path'), { status: 400 }); }
      const segments = path.split('/').filter(Boolean);
      if (reserved.has(segments[0]?.toLowerCase()) || path.includes('\\') || path.includes('\0') || segments.some(segment => segment.startsWith('.'))) throw notFound();
      if (req.method !== 'GET' && req.method !== 'HEAD') throw notFound();
      const candidate = resolve(root, `.${path}`);
      if (!inside(root, candidate)) throw notFound();
      // express.static confines lexical paths, but follows symlinks. Check the actual
      // file/index as well so even an accidentally linked private directory is excluded.
      try {
        let actual = await realpath(candidate);
        if (!inside(root, actual)) throw notFound();
        if ((await stat(actual)).isDirectory()) actual = await realpath(join(actual, 'index.html'));
        if (!inside(root, actual) || !(await stat(actual)).isFile()) throw notFound();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code && !['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!)) throw error;
        throw notFound();
      }
      serve(req, res, next);
    })().catch(next);
  };
}
