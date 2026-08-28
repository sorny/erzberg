/**
 * Correctness linting only — no stylistic rules.
 *
 * The codebase has a settled house style (no semicolons, aligned const blocks)
 * that no formatter here is allowed to relitigate. What this config is for is the
 * class of bug a reader misses: an undeclared global, a binding left behind by a
 * refactor, a hook whose dependencies do not match what it reads.
 *
 * WHY NOT eslint-plugin-react-hooks' full recommended set: as of v7 it ships the
 * React Compiler rules, and three of them are structurally incompatible with
 * react-three-fiber. `immutability` forbids mutating anything reachable from a
 * hook — but driving three.js *is* mutating material uniforms and render state in
 * an effect, which is what lets a slider retint a surface without a shader
 * recompile. `refs` forbids reading ref.current during render, which is how the
 * audio and worker hooks keep a latest-value handle. Measured on this tree those
 * two plus `set-state-in-effect` produce 47 findings and every one of them is a
 * pattern that is correct here, so adopting them would mean 47 permanent
 * suppressions describing working code. The two rules below are the ones that
 * find real bugs in a React 18 app.
 */
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Bindings deliberately introduced and discarded are spelled `_` in this
// codebase (`catch (_)`), so that prefix is the opt-out everywhere.
const unusedVars = ['error', {
  varsIgnorePattern: '^_',
  argsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
}]

/**
 * Two props of the same name on one JSX element.
 *
 * JSX keeps the last one and drops the rest silently — no error, no warning,
 * nothing in the output to look at. `Section` in panel/ui.jsx carried `style`
 * twice for exactly as long as it took someone to read the file: a
 * filtering-only `{ cursor: 'default' }` written above the real style object,
 * discarded on every render, so the header advertised a pointer over a control
 * the filter had already made inert.
 *
 * This is `eslint-plugin-react`'s `jsx-no-duplicate-props`, written out rather
 * than installed: that plugin's peer range stops at eslint ^9.7 and this project
 * is on 10, so adding it would mean --legacy-peer-deps and a broken `npm ci`.
 * Twenty lines against the AST is the cheaper answer, and it is the only rule
 * from that plugin this config wants — pure correctness, nothing stylistic,
 * which is the bar the rest of this file sets.
 */
const noDuplicateProps = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow duplicate props on a JSX element' },
    schema: [],
    messages: { duplicate: "'{{name}}' is set twice on this element; JSX keeps only the last." },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const seen = new Set()
        for (const attr of node.attributes) {
          // A spread may legitimately sit between two of the same name — the
          // second is then an intentional override of whatever the spread
          // carried — so seeing one clears the slate.
          if (attr.type === 'JSXSpreadAttribute') { seen.clear(); continue }
          const n = attr.name
          const name = n.type === 'JSXNamespacedName'
            ? `${n.namespace.name}:${n.name.name}`
            : n.name
          if (seen.has(name)) context.report({ node: attr, messageId: 'duplicate', data: { name } })
          seen.add(name)
        }
      },
    }
  },
}

export default [
  { ignores: ['dist/**', 'test-results/**'] },

  js.configs.recommended,

  // ── App source: browser ──────────────────────────────────────────────────
  // Workers are excluded rather than merely overridden: flat config *merges*
  // languageOptions.globals across every block a file matches, so leaving them in
  // here would keep `document` and `window` defined inside the workers no matter
  // what the worker block below says. They get their own block instead.
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/utils/*.worker.js'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      local: { rules: { 'jsx-no-duplicate-props': noDuplicateProps } },
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': unusedVars,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // panel/ui.jsx exports BG, SURF, ACCENT, W beside its components; those are
      // constants and do not break Fast Refresh.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'local/jsx-no-duplicate-props': 'error',
    },
  },

  // ── Workers: self/postMessage, and genuinely no DOM ───────────────────────
  // Self-contained because of the merge rule above. The point is that reaching for
  // `document` in here is a runtime ReferenceError inside a worker, where it is
  // easy to miss — so it should be a lint error, not silently fine.
  {
    files: ['src/utils/*.worker.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.worker,
    },
    rules: { 'no-unused-vars': unusedVars },
  },

  // ── Build and tooling: Node ──────────────────────────────────────────────
  {
    files: ['vite.config.js', 'playwright.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: { 'no-unused-vars': unusedVars },
  },

  // ── Specs and scripts: Node *and* browser ────────────────────────────────
  // These files are Node on the outside, but the bodies of page.evaluate() and
  // page.addInitScript() run in the page — document, getComputedStyle and
  // requestAnimationFrame are legitimately in scope there. ESLint cannot tell the
  // two scopes apart inside one file, so the union is the honest setting; the
  // alternative is 44 no-undef reports on correct code.
  {
    files: ['tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { 'no-unused-vars': unusedVars },
  },
]
