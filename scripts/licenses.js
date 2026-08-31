/**
 * Collects the licence of every package that ships, into `dist/THIRD-PARTY-NOTICES.txt`.
 *
 * Every permissive licence in the tree asks for the same small thing and it is
 * the one obligation a bundler quietly breaks: MIT says its copyright and
 * permission notice "shall be included in all copies or substantial portions of
 * the Software", BSD and ISC say the same in their own words, and Apache-2.0 §4
 * wants a copy of the licence and the notices retained. A minified bundle has
 * none of them — esbuild strips comments, and the deployed site is a
 * distribution of React, three.js and thirty-odd others with every notice gone.
 *
 * Shipping the notices as a separate file alongside the bundle is the standard
 * remedy and the one every licence contemplates: the notice travels with the
 * distribution, it just is not inside the JavaScript.
 *
 * Scope is the *production* dependency closure — `npm ls --omit=dev`. Dev
 * dependencies are not distributed, so Vite, ESLint, Playwright and Vitest are
 * deliberately absent. Assets under `public/` carry their own licence files and
 * are copied verbatim into `dist/`, so they are already covered where they land.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'dist', 'THIRD-PARTY-NOTICES.txt')

/** Walk `npm ls --omit=dev --all --json` into a flat name→version set. */
function productionClosure() {
  const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const seen = new Map()
  const walk = (deps) => {
    for (const [name, node] of Object.entries(deps || {})) {
      if (!seen.has(name)) seen.set(name, node.version || '?')
      walk(node.dependencies)
    }
  }
  walk(JSON.parse(raw).dependencies)
  return seen
}

/** The licence text as published, or the SPDX id if the package ships no file. */
const LICENSE_FILES = /^(LICEN[CS]E|COPYING|NOTICE)(\.(md|txt|markdown))?$/i

function readPackage(name) {
  const dir = join(ROOT, 'node_modules', name)
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const spdx = typeof pkg.license === 'string'
    ? pkg.license
    : (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(' OR ') : null)

  const texts = []
  let entries = []
  try { entries = readdirSync(dir) } catch { /* nothing to read */ }
  for (const f of entries.filter((f) => LICENSE_FILES.test(f)).sort()) {
    try { texts.push({ file: f, text: readFileSync(join(dir, f), 'utf8').trim() }) } catch { /* skip */ }
  }
  return {
    name, version: pkg.version, spdx,
    // `webgl-constants` declares no `license` field and its LICENSE file is MIT;
    // an SPDX id read from the manifest alone would report it as unknown.
    homepage: pkg.homepage || (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) || null,
    author: typeof pkg.author === 'string' ? pkg.author : pkg.author?.name || null,
    texts,
  }
}

const closure = productionClosure()
const packages = [...closure.keys()].sort().map(readPackage).filter(Boolean)

/**
 * Canonical text per SPDX id, borrowed from the packages that do ship a file.
 *
 * Six packages here declare a licence and ship no copy of it, and for one of
 * them that is not merely untidy: `lerc` is Apache-2.0 and reaches the bundle,
 * and Apache-2.0 §4(a) requires giving every recipient "a copy of this License".
 * An SPDX identifier is a reference, not a copy.
 *
 * Taking the text from a sibling that declares the same identifier keeps this
 * self-maintaining — no licence blobs inlined here to drift out of date — and
 * the longest candidate is preferred because a package that appends its own
 * copyright line to the licence is a worse source than one that ships it plain.
 */
const canonical = new Map()
for (const p of packages) {
  if (!p.spdx || !p.texts.length) continue
  const text = p.texts[0].text
  const held = canonical.get(p.spdx)
  if (!held || text.length > held.length) canonical.set(p.spdx, text)
}
for (const p of packages) {
  if (p.texts.length || !p.spdx) continue
  const text = canonical.get(p.spdx)
  if (text) p.borrowed = text
}
const missing = packages.filter((p) => !p.texts.length && !p.borrowed)

const rule = '='.repeat(78)
const out = [
  'THIRD-PARTY NOTICES',
  rule,
  '',
  'erzberg is MIT licensed; see LICENSE. The software it is built from is not all',
  'the same licence, and each of those asks that its notice travel with any copy.',
  'Minification removes them from the bundle, so they are collected here instead.',
  '',
  `${packages.length} packages, from the production dependency closure. Development`,
  'tooling — Vite, ESLint, Playwright, Vitest and their trees — is not distributed',
  'and is not listed.',
  '',
  'Fonts and icons are not npm packages and carry their own licences where they',
  'ship: public/fonts/OFL.txt, public/fonts/single-line/LICENSE.txt,',
  'public/icons/LICENSE.',
  '',
  `Generated by scripts/licenses.js.`,
  '', rule, '', 'CONTENTS', '',
  ...packages.map((p) => `  ${p.name}@${p.version}${p.spdx ? `  —  ${p.spdx}` : ''}`),
  '', rule, '',
]

for (const p of packages) {
  out.push(rule, `${p.name}@${p.version}`, rule, '')
  if (p.spdx) out.push(`SPDX-License-Identifier: ${p.spdx}`)
  if (p.homepage) out.push(`Homepage: ${p.homepage.replace(/^git\+/, '').replace(/\.git$/, '')}`)
  if (p.author) out.push(`Author: ${p.author}`)
  out.push('')
  if (p.texts.length) {
    for (const t of p.texts) out.push(`--- ${t.file} ---`, '', t.text, '')
  } else if (p.borrowed) {
    out.push(`(This package ships no licence file of its own. The text of ${p.spdx},`,
             ' which its manifest declares, follows.)', '', p.borrowed, '')
  } else {
    out.push('(This package ships no licence file. The SPDX identifier above is the',
             ' licence its manifest declares.)', '')
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, out.join('\n'))

console.log(`[licenses] ${packages.length} packages → dist/THIRD-PARTY-NOTICES.txt`)
const borrowed = packages.filter((p) => p.borrowed)
if (borrowed.length) {
  console.log(`[licenses] ${borrowed.length} without a licence file, text supplied from ` +
    `a sibling: ${borrowed.map((p) => `${p.name} (${p.spdx})`).join(', ')}`)
}
if (missing.length) {
  console.log(`[licenses] ${missing.length} with neither a licence file nor a resolvable ` +
    `SPDX text: ${missing.map((p) => p.name).join(', ')}`)
}
