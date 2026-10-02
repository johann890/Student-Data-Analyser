#!/usr/bin/env node
/* build.js: fold the application into one .html file that can be opened on its
   own.

   MLP/index.html is the page, not the application: it links 11 stylesheets and
   39 scripts, and the order of those lists is load-bearing. Copy the page
   without the folder and nothing runs. The supervisor's packaging decision was
   "just open the .html file", so this produces a file that honours it.

   Each <link rel="stylesheet"> and each <script src> is replaced where it
   stands by the file it names, so the load order is the page's own and no list
   is kept here to drift out of step with it.

   Usage:  node build/build.js [sourceDir] [outFile]
   Default: MLP -> build/student-data-analyser.html

   The output has no timestamp in it, so building twice from the same source
   gives the same bytes. */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const srcDir = path.resolve(ROOT, process.argv[2] || 'MLP');
const outFile = path.resolve(ROOT, process.argv[3] || 'build/student-data-analyser.html');

/* A closing tag inside the text being inlined would end the block early. It can
   only legally appear inside a string or a comment, where a backslash before
   the slash means the same thing, so escaping it is safe in both languages. */
function neutralise(text, tag) {
  const re = new RegExp('</' + tag, 'gi');
  const hits = (text.match(re) || []).length;
  return { text: hits ? text.replace(re, '<\\/' + tag) : text, hits: hits };
}

function read(rel) {
  const file = path.join(srcDir, rel);
  if (!fs.existsSync(file)) {
    throw new Error('index.html asks for ' + rel + ', which is not in ' + srcDir);
  }
  return fs.readFileSync(file, 'utf8');
}

const htmlPath = path.join(srcDir, 'index.html');
if (!fs.existsSync(htmlPath)) throw new Error('No index.html in ' + srcDir);
let html = fs.readFileSync(htmlPath, 'utf8');

const taken = { css: [], js: [] };
let escaped = 0;
const left = [];

/* Anything still pointing outside the file defeats the point of building it.
   Collected from the markup before the inlining and from the stylesheets as
   they are read, never from the scripts: JavaScript is full of variables named
   url and of strings that look like paths. Data URIs and fragments are part of
   the document and stay. */
function noteOutsideRefs(text, re, keep) {
  text.replace(re, function (m, url) {
    if (!keep.test(url)) left.push(url);
    return m;
  });
}
noteOutsideRefs(html, /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi,
                /^(data:|#|https?:|mailto:)/i);

/* STYLESHEETS
   Matched on the whole tag rather than on href alone, so a <link> that is not a
   stylesheet (an icon, say) is left where it is. */
html = html.replace(/<link\b[^>]*>/gi, function (tag) {
  if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) return tag;
  const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
  if (!href) return tag;
  const css = read(href[1]);
  noteOutsideRefs(css, /url\(\s*["']?([^"')]+)["']?\s*\)/gi, /^(data:|#)/i);
  const safe = neutralise(css, 'style');
  escaped += safe.hits;
  taken.css.push(href[1]);
  return '<style>\n/* ' + href[1] + ' */\n' + safe.text + '\n</style>';
});

/* SCRIPTS
   Only tags with a src. There are none without one in the page today, and an
   inline block would already be inline. */
html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, function (tag, attrs) {
  const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
  if (!src) return tag;
  const safe = neutralise(read(src[1]), 'script');
  escaped += safe.hits;
  taken.js.push(src[1]);
  return '<script>\n/* ' + src[1] + ' */\n' + safe.text + '\n</script>';
});

// The files just folded in are no longer outside anything.
const inlined = new Set(taken.css.concat(taken.js));
const outstanding = [...new Set(left.filter(function (u) { return !inlined.has(u); }))];

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('source   ' + path.relative(ROOT, srcDir));
console.log('inlined  ' + taken.css.length + ' stylesheets, ' + taken.js.length + ' scripts');
if (escaped) console.log('escaped  ' + escaped + ' closing tag(s) inside the inlined text');
if (outstanding.length) {
  console.log('WARNING  still refers to files outside itself: ' + outstanding.join(', '));
}
console.log('written  ' + path.relative(ROOT, outFile) + '  (' + kb(Buffer.byteLength(html)) + ')');
