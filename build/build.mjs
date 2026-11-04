/**
 * Build the Conversation Flow client bundle for the DSH web module loader.
 *
 * Output format matches what `@deepseek-ai/dsh-client-modules` serves:
 *   window.__ModuleLoader__.load({ id, factory(require) { ... } })
 * React and react-dom stay external (they live in the shell's frozen module table);
 * React Flow and its pure-JS dependencies are inlined.
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ID = '@local/dsh-conversation-flow';
// 开发副本；发版时整份复制到 releases/vX.Y.Z
const outDir = resolve(here, '..', 'dev', 'client.js');

const result = await build({
  entryPoints: [resolve(here, 'src', 'client.jsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome114'],
  jsx: 'automatic',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  loader: { '.css': 'text' },
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

const body = result.outputFiles[0].text;
const wrapped =
  '/* Conversation Flow by DSH plugin build — do not edit directly. Source: build/src. */\n' +
  'window.__ModuleLoader__.load({\n' +
  '  id: ' + JSON.stringify(PACKAGE_ID) + ',\n' +
  '  factory: (require) => {\n' +
  '    var module = { exports: {} };\n' +
  '    var exports = module.exports;\n' +
  body +
  '\n    return module.exports;\n' +
  '  },\n' +
  '});\n';

await mkdir(dirname(outDir), { recursive: true });
await writeFile(outDir, wrapped, 'utf8');
const bytes = Buffer.byteLength(wrapped, 'utf8');
console.log('wrote ' + outDir + ' (' + (bytes / 1024).toFixed(1) + ' KiB)');
