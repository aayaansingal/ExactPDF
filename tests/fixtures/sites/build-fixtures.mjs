/**
 * Generates the controlled fixture pages named in the compatibility matrix.
 *
 * They are generated rather than hand-written so that the difficult properties
 * -- a 12,000px page, 200 lazy images, a virtualized list -- are exact and
 * reproducible. A visual regression test is only meaningful if its input is
 * byte-identical on every run, so nothing here uses randomness, the network,
 * the current date, or a webfont.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE_STYLE = `
  *{ box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 Georgia, 'Times New Roman', serif; color: #16181d; background: #fff; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 32px; line-height: 1.2; margin: 0 0 16px; }
  h2 { font-size: 22px; margin: 32px 0 12px; }
  p { margin: 0 0 16px; }
  code, pre { font-family: ui-monospace, Menlo, monospace; }
  pre { background: #f4f5f7; padding: 14px; overflow-x: auto; border-radius: 6px; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border: 1px solid #d7dae0; padding: 7px 10px; text-align: left; }
  th { background: #f4f5f7; }
  .box { width: 100%; height: 180px; background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 8px; }
`;

/** Deterministic filler so page height is identical on every generation. */
function lorem(index) {
  const sentences = [
    'The capture must reproduce this paragraph exactly as it appears on screen.',
    'Page breaks should fall between paragraphs rather than through a line of text.',
    'Selectable text is the defining property of a Document mode export.',
    'A tiled capture must not repeat this line at a seam boundary.',
    'Margins are measured from the trimmed content, not from the viewport.',
  ];
  return sentences[index % sentences.length];
}

function paragraphs(count, offset = 0) {
  return Array.from(
    { length: count },
    (_, index) => `<p>${index + offset + 1}. ${lorem(index + offset)} ${lorem(index + offset + 2)}</p>`,
  ).join('\n');
}

function page(title, body, extraStyle = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${BASE_STYLE}${extraStyle}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

const FIXTURES = {
  /** Static article: the baseline every other fixture is compared against. */
  'static-article.html': page(
    'A Static Article',
    `<div class="wrap">
      <h1>A Static Article</h1>
      <p><em>By a test fixture, for a test fixture.</em></p>
      ${paragraphs(6)}
      <h2>A second section</h2>
      ${paragraphs(8, 6)}
      <blockquote>A quotation that should survive Document mode intact.</blockquote>
      <h2>A third section</h2>
      ${paragraphs(10, 14)}
      <p>Ends with <a href="https://example.com/target">a link that must remain clickable</a>.</p>
    </div>`,
  ),

  /** Documentation: code blocks, side navigation, anchors. */
  'documentation.html': page(
    'API Documentation',
    `<nav class="sidenav">
      <ul><li><a href="#one">Getting started</a></li><li><a href="#two">Reference</a></li></ul>
    </nav>
    <div class="wrap doc">
      <h1>API Documentation</h1>
      <p>Navigation on the left must not appear in a Clean Document export.</p>
      <h2 id="one">Getting started</h2>
      <pre><code>const client = new Client({ apiKey });
const result = await client.capture({
  mode: 'element',
  quality: 'balanced',
});
console.log(result.pageCount);</code></pre>
      ${paragraphs(4)}
      <h2 id="two">Reference</h2>
      <table>
        <tr><th>Option</th><th>Type</th><th>Default</th></tr>
        <tr><td>mode</td><td>string</td><td>element</td></tr>
        <tr><td>quality</td><td>string</td><td>balanced</td></tr>
        <tr><td>pageSize</td><td>string</td><td>original</td></tr>
      </table>
      ${paragraphs(4, 4)}
    </div>`,
    `.sidenav { position: fixed; top: 0; left: 0; width: 180px; height: 100vh; background: #f4f5f7; padding: 20px; font-size: 14px; }
     .sidenav ul { list-style: none; padding: 0; margin: 0; }
     .doc { margin-left: 200px; }`,
  ),

  /** AI conversation: alternating roles, wide code, long mixed content. */
  'ai-conversation.html': page(
    'A Conversation',
    `<div class="wrap">
      <h1>A Conversation</h1>
      ${Array.from({ length: 14 }, (_, index) =>
        index % 2 === 0
          ? `<div class="turn turn--user"><strong>You</strong><p>${lorem(index)}</p></div>`
          : `<div class="turn turn--reply"><strong>Assistant</strong><p>${lorem(index)} ${lorem(index + 1)}</p>
             ${index === 3 ? '<pre><code>function veryLongLineThatShouldWrapOrScrollWithoutBreakingTheCaptureAtAll() { return true; }</code></pre>' : ''}</div>`,
      ).join('\n')}
    </div>`,
    `.turn { padding: 14px 16px; margin: 0 0 12px; border-radius: 10px; }
     .turn--user { background: #eef2ff; }
     .turn--reply { background: #f7f8fa; }
     .turn p { margin: 6px 0 0; }`,
  ),

  /** Authenticated-style page: content behind a simulated logged-in shell. */
  'lms-page.html': page(
    'Course Notes',
    `<header class="chrome"><span>Test LMS</span><span>Signed in as fixture@example.test</span></header>
     <div class="wrap">
       <h1>Week 4: Integration by parts</h1>
       <p class="meta">Posted 2026-07-20 · Visible only to enrolled students</p>
       ${paragraphs(5)}
       <div class="box" role="img" aria-label="A worked example diagram"></div>
       <p class="caption">Figure 1. A worked example.</p>
       ${paragraphs(5, 5)}
     </div>`,
    `.chrome { display: flex; justify-content: space-between; padding: 12px 20px; background: #1e293b; color: #fff; font-size: 13px; font-family: sans-serif; }
     .meta { color: #64748b; font-size: 13px; }
     .caption { color: #64748b; font-size: 13px; text-align: center; }`,
  ),

  /** Wide data table with a sticky header row. */
  'data-table.html': page(
    'Quarterly Figures',
    `<div class="wrap wide">
      <h1>Quarterly Figures</h1>
      <p>The header must not repeat on every page of a full-page capture.</p>
      <table class="sticky">
        <thead><tr>${['Region', 'Q1', 'Q2', 'Q3', 'Q4', 'Total', 'Change', 'Notes']
          .map((heading) => `<th>${heading}</th>`)
          .join('')}</tr></thead>
        <tbody>
          ${Array.from(
            { length: 60 },
            (_, index) =>
              `<tr><td>Region ${index + 1}</td>${Array.from(
                { length: 6 },
                (_, column) => `<td>${(index + 1) * (column + 3)}</td>`,
              ).join('')}<td>Row ${index + 1} note</td></tr>`,
          ).join('\n')}
        </tbody>
      </table>
    </div>`,
    `.wide { max-width: 1100px; }
     .sticky thead th { position: sticky; top: 0; background: #f4f5f7; z-index: 2; }`,
  ),

  /** Image-heavy page with lazy loading and inline SVG placeholders. */
  'image-heavy.html': page(
    'A Gallery',
    `<div class="wrap">
      <h1>A Gallery</h1>
      <p>Every tile is an inline data URI, so the fixture never touches the network.</p>
      <div class="grid">
        ${Array.from(
          { length: 24 },
          (_, index) =>
            `<figure><div class="tile tile--${index % 4}"></div><figcaption>Tile ${index + 1}</figcaption></figure>`,
        ).join('\n')}
      </div>
    </div>`,
    `.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
     figure { margin: 0; }
     figcaption { font-size: 12px; color: #64748b; text-align: center; margin-top: 4px; }
     .tile { height: 130px; border-radius: 6px; }
     .tile--0 { background: #2563eb; } .tile--1 { background: #7c3aed; }
     .tile--2 { background: #0891b2; } .tile--3 { background: #ca8a04; }`,
  ),

  /** Infinite scroll: appends content on scroll, so capture must self-limit. */
  'infinite-scroll.html': page(
    'An Endless Feed',
    `<div class="wrap"><h1>An Endless Feed</h1><div id="feed">${paragraphs(20)}</div></div>
     <script>
       // Appends forever, which is exactly the condition the capture limit exists for.
       let batch = 20;
       addEventListener('scroll', () => {
         if (window.scrollY + window.innerHeight > document.body.scrollHeight - 400 && batch < 400) {
           const feed = document.getElementById('feed');
           for (let index = 0; index < 20; index += 1) {
             const p = document.createElement('p');
             p.textContent = (batch + index + 1) + '. Appended on scroll.';
             feed.appendChild(p);
           }
           batch += 20;
         }
       });
     </script>`,
  ),

  /** Canvas chart: no accessible DOM, so only a visual capture can hold it. */
  'canvas-chart.html': page(
    'A Rendered Chart',
    `<div class="wrap">
      <h1>A Rendered Chart</h1>
      <p>The chart below exists only as canvas pixels.</p>
      <canvas id="chart" width="640" height="320"></canvas>
      <p>Document mode should fall back to Exact for a page like this.</p>
    </div>
    <script>
      const context = document.getElementById('chart').getContext('2d');
      context.fillStyle = '#f8fafc';
      context.fillRect(0, 0, 640, 320);
      const values = [40, 120, 80, 200, 160, 260, 220, 300];
      values.forEach((value, index) => {
        context.fillStyle = '#2563eb';
        context.fillRect(40 + index * 72, 300 - value, 48, value);
      });
      context.strokeStyle = '#94a3b8';
      context.beginPath();
      context.moveTo(30, 300);
      context.lineTo(620, 300);
      context.stroke();
    </script>`,
  ),

  /** Dark mode: tests background handling and the force-light option. */
  'dark-mode.html': page(
    'A Dark Article',
    `<div class="wrap">
      <h1>A Dark Article</h1>
      ${paragraphs(10)}
      <pre><code>theme.background = '#0f172a';</code></pre>
      ${paragraphs(6, 10)}
    </div>`,
    `body { background: #0f172a; color: #e2e8f0; }
     pre { background: #1e293b; color: #e2e8f0; }
     th, td { border-color: #334155; }`,
  ),

  /** Complex fixed layout: sticky header, floating controls, a long body. */
  'complex-fixed.html': page(
    'A Sticky Layout',
    `<header class="bar">Sticky header that must appear exactly once</header>
     <aside class="fab">Floating control</aside>
     <div class="wrap top">
       <h1>A Sticky Layout</h1>
       ${paragraphs(40)}
     </div>
     <footer class="bar bar--bottom">Fixed footer</footer>`,
    `.bar { position: fixed; top: 0; left: 0; right: 0; padding: 12px 20px; background: #2563eb; color: #fff; font-family: sans-serif; font-size: 14px; z-index: 10; }
     .bar--bottom { top: auto; bottom: 0; background: #1e293b; }
     .fab { position: fixed; right: 24px; bottom: 72px; padding: 12px 16px; background: #7c3aed; color: #fff; border-radius: 999px; font-family: sans-serif; font-size: 13px; z-index: 10; }
     .top { padding-top: 70px; padding-bottom: 70px; }`,
  ),
};

mkdirSync(HERE, { recursive: true });

for (const [name, html] of Object.entries(FIXTURES)) {
  writeFileSync(join(HERE, name), html);
  console.log(`  ${name} (${(html.length / 1024).toFixed(1)} kB)`);
}
