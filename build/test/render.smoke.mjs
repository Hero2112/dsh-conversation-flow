/**
 * Server-render smoke test for the Conversation Flow page.
 *
 * Bundles `src/page.jsx` exactly the way the shipped client bundle does (React
 * Flow inlined, React external) and renders the page once with
 * `renderToStaticMarkup`, so import-time and render-time mistakes (bad JSX,
 * missing component, invalid style object, hooks misuse) surface without a
 * browser.
 */
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, '.tmp');
const outFile = path.join(outDir, 'page.smoke.cjs');

await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src', 'page.jsx')],
  outfile: outFile,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'chrome110',
  jsx: 'automatic',
  loader: { '.css': 'text' },
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'],
  logLevel: 'error',
});

const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { createRequire } = await import('node:module');
const page = createRequire(import.meta.url)(outFile);

const fakeCtx = {
  get() {
    return undefined;
  },
  effect() {},
  on() {
    return () => {};
  },
};

assert.equal(typeof page.ConversationFlowPage, 'function', 'page component export');

const markup = renderToStaticMarkup(React.createElement(page.ConversationFlowPage, { ctx: fakeCtx }));
assert.ok(markup.length > 2000, 'page should render a real subtree, got ' + markup.length + ' chars');
assert.match(markup, /对话流|Conversation Flow/, 'header title rendered');
assert.match(markup, /react-flow/, 'React Flow canvas mounted');

const checks = [
  ['renders header + rail + canvas + inspector shell', () => {
    assert.match(markup, /传输记录|Transfer log/);
    assert.match(markup, /连线设置|Channel settings/);
  }],
  ['embeds the React Flow stylesheet', () => {
    assert.ok(markup.includes('.react-flow__pane'), 'React Flow CSS text present in the style element');
    assert.ok(markup.includes('.cf-node'), 'plugin CSS present in the style element');
  }],
  ['creating a node list entry needs sessions state', () => {
    // with no Host data the rail shows its empty state instead of crashing
    assert.match(markup, /还没有可用的对话|No conversations yet/);
  }],
  ['canvas toolbar and grid background render by default', () => {
    assert.match(markup, /画布|Canvas/, 'canvas settings button renders');
    assert.match(markup, /react-flow__background/, 'grid background renders by default');
  }],
  ['grid pattern uses the computed grid color', () => {
    assert.ok(
      markup.includes('rgba(232,235,240,0.18)'),
      'default dark-canvas grid color is wired into the pattern',
    );
  }],
  ['topic bar renders with create / rename / delete controls', () => {
    assert.match(markup, /cf-topicbar/, 'topic bar container present');
    assert.match(markup, /新建主题|New topic/, 'new-topic control present');
    assert.match(markup, /改名|Rename/, 'rename control present');
    assert.match(markup, /删除|Delete/, 'delete control present');
  }],
  ['no unresolved placeholder text', () => {
    assert.equal(/\{to\}|\{reason\}|undefined<\/div>/.test(markup), false);
  }],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    fn();
    console.log('PASS  ' + name);
  } catch (error) {
    failed += 1;
    console.log('FAIL  ' + name + '\n      ' + error.message);
  }
}

await rm(outDir, { recursive: true, force: true });
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' render checks passed');
process.exit(failed === 0 ? 0 : 1);
