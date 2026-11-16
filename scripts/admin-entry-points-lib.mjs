/**
 * Shared parsing for `scripts/list-admin-entry-points.mjs` (CI) and
 * `tests/integration/admin-entry-points.test.ts`. Everything works on
 * { path, src } pairs, so the test can feed it fixture source strings.
 *
 * Parsed with the TypeScript compiler, so comments, strings and return types
 * cannot fool it. Fail closed: a form it cannot classify becomes a problem,
 * never a skip.
 */
import ts from 'typescript';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const BLOCK_CHECK = 'assertNotBlocked';
export const WRITE_LIMIT = 'enforceAdminWriteLimit';
/** Calling one of these makes a page, route or action an admin entry point wherever it lives. */
export const ADMIN_GUARDS = ['requireAdmin', 'requireAdminPage', 'requireAdminForRoute'];
/** Folders whose pages, routes and 'use server' exports are admin entry points. */
export const ADMIN_AREAS = /^src\/(?:app\/admin|app\/api\/admin|features\/admin)\//;
/** Calls that may be awaited before the guard (see guardFirstProblem). */
export const PRE_GUARD_CALLS = [BLOCK_CHECK];

const isPagePath = (path) => /^src\/app\/(?:.*\/)?page\.[jt]sx?$/.test(path);
const isRoutePath = (path) => /^src\/app\/(?:.*\/)?route\.[jt]s$/.test(path);

/** @param {string} path @param {string} src */
export function parse(path, src) {
  const kind = /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : /\.m?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, kind);
}

/** Whether a directive prologue (leading string statements) holds 'use server'. */
function hasUseServer(statements) {
  for (const stmt of statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteral(stmt.expression)) return false;
    if (stmt.expression.text === 'use server') return true;
  }
  return false;
}

/** @param {ts.SourceFile} sf A file whose directive prologue is 'use server'. */
export const isServerActionFile = (sf) => hasUseServer(sf.statements);

const isFunctionLike = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n) ||
  ts.isConstructorDeclaration(n);

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** Functions with an inline 'use server' in their own body, anywhere in the file. */
export function inlineServerActions(sf) {
  const found = [];
  const visit = (n) => {
    if (isFunctionLike(n) && n.body && ts.isBlock(n.body) && hasUseServer(n.body.statements)) found.push(lineOf(sf, n));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

const modifiersOf = (node) => (ts.canHaveModifiers?.(node) ? ts.getModifiers(node) : node.modifiers) ?? [];
const hasModifier = (node, kind) => modifiersOf(node).some((m) => m.kind === kind);

/** Strips `( … )`, `as T`, `satisfies T`, `<T>x` and `x!` around an expression. */
function unwrapTypes(e) {
  while (
    e &&
    (ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isNonNullExpression(e))
  ) {
    e = e.expression;
  }
  return e;
}

/**
 * The function behind a top-level name, following `const GET = handler`
 * aliases. null = not a plain function (a wrapper call, an import, a class…).
 */
export function functionOf(locals, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const node = locals.get(name);
  if (!node) return null;
  if (ts.isFunctionDeclaration(node)) return node.body ? node : null;
  return functionOfExpression(locals, node.initializer, seen);
}

function functionOfExpression(locals, expr, seen = new Set()) {
  const init = unwrapTypes(expr);
  if (!init) return null;
  if (ts.isIdentifier(init)) return functionOf(locals, init.text, seen);
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  return null;
}

/**
 * Top-level functions and variables by name, and every runtime export:
 * `export (async) function`, `export const|let|var`, `export { a, b as c }`,
 * `export default <function | name | expression>`. Type-only exports are
 * skipped. Anything else that exports a value (re-exports from another
 * module, `export *`, destructured exports, classes, enums, namespaces,
 * `export =`) goes to `unknown`, because its body cannot be seen.
 *
 * @param {ts.SourceFile} sf
 * @returns {{ locals: Map<string, ts.Node>, exported: { name: string, fn: ts.SignatureDeclaration | null }[], unknown: string[] }}
 */
export function declarations(sf) {
  const locals = new Map();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) locals.set(stmt.name.text, stmt);
    else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) if (ts.isIdentifier(decl.name)) locals.set(decl.name.text, decl);
    }
  }

  const exported = [];
  const unknown = [];
  const at = (node) => `line ${lineOf(sf, node)}`;
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue;
      if (stmt.moduleSpecifier || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) {
        unknown.push(`${at(stmt)}: re-export \`${stmt.getText(sf)}\``);
        continue;
      }
      for (const el of stmt.exportClause.elements) {
        if (el.isTypeOnly) continue;
        const local = (el.propertyName ?? el.name).text;
        exported.push({ name: el.name.text, fn: functionOf(locals, local) });
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      if (stmt.isExportEquals) unknown.push(`${at(stmt)}: \`export =\``);
      else exported.push({ name: 'default', fn: functionOfExpression(locals, stmt.expression) });
      continue;
    }
    if (ts.isImportEqualsDeclaration(stmt) && hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      unknown.push(`${at(stmt)}: \`export import\``);
      continue;
    }
    if (!hasModifier(stmt, ts.SyntaxKind.ExportKeyword) || hasModifier(stmt, ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isFunctionDeclaration(stmt)) {
      if (!stmt.body) continue; // overload signature
      const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
      exported.push({ name: isDefault ? 'default' : stmt.name.text, fn: stmt });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) exported.push({ name: decl.name.text, fn: functionOf(locals, decl.name.text) });
        else unknown.push(`${at(decl)}: destructured export \`${decl.name.getText(sf)}\``);
      }
    } else {
      unknown.push(`${at(stmt)}: exported ${ts.SyntaxKind[stmt.kind]}`);
    }
  }
  return { locals, exported, unknown };
}

/** The name a call goes to: `f(…)` → f, `a.b.f(…)` → f. */
function calleeName(call) {
  const e = unwrapTypes(call.expression);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/**
 * Whether `node` calls `fn(…)`. With `locals`, a call to another top-level
 * function of the same file is followed too (once each), so a check in a
 * shared helper counts for every export that calls the helper.
 */
export function calls(node, fn, locals = null, seen = new Set()) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const callee = n.expression.text;
      if (callee === fn) {
        found = true;
        return;
      }
      if (locals && !seen.has(callee)) {
        const target = functionOf(locals, callee, seen);
        if (target?.body && calls(target.body, fn, locals, seen)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Whether the file calls any admin guard (by name, also as `x.requireAdmin(…)`). */
function callsAdminGuard(sf) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && ADMIN_GUARDS.includes(calleeName(n) ?? '')) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/**
 * Scans source files (repo-relative `path`, `src` text).
 *
 * - `entries`: the admin entry points for the manifest. Pages under
 *   src/app/admin; route handlers (METHODS) and 'use server' exports, any
 *   file name, in ADMIN_AREAS; plus any page, route or 'use server' file
 *   elsewhere in src/app or src that calls an admin guard.
 * - `actionEntries`: every route handler under src/app and every export of a
 *   'use server' file under src, for the block and write-limit checks.
 *   `admin` marks the 'use server' exports that are admin entries.
 * - `unknown`: what cannot be classified: inline 'use server' functions
 *   (anywhere under src) and export forms `declarations()` cannot see into,
 *   in 'use server' files and route files. Each one must fail the check.
 *
 * @param {{ path: string, src: string }[]} files
 */
export function scanSources(files) {
  const entries = [];
  const actionEntries = [];
  const unknown = [];
  for (const { path, src } of files) {
    if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) || /\.d\.[cm]?ts$/.test(path)) continue;
    const page = isPagePath(path);
    const route = isRoutePath(path);
    const mentionsServer = src.includes('use server');
    const mentionsGuard = ADMIN_GUARDS.some((g) => src.includes(g));
    // Cheap pre-filter: only parse files that can hold an entry point.
    if (!mentionsServer && !route && !(page && (path.startsWith('src/app/admin/') || mentionsGuard))) continue;

    const sf = parse(path, src);
    if (mentionsServer) {
      for (const line of inlineServerActions(sf)) {
        unknown.push(`${path}:${line}: inline 'use server' function. Move it to a 'use server' file as a named export so it can be checked`);
      }
    }
    const serverFile = mentionsServer && isServerActionFile(sf);
    const admin = ADMIN_AREAS.test(path) || (mentionsGuard && callsAdminGuard(sf));

    if (page && (path.startsWith('src/app/admin/') || admin)) {
      entries.push({ kind: 'page', path });
    }
    if (!route && !serverFile) continue;

    const decls = declarations(sf);
    for (const problem of decls.unknown) {
      unknown.push(`${path} ${problem}: cannot see what it exports. Declare the ${route ? 'handler' : 'action'} in this file`);
    }
    for (const { name, fn } of decls.exported) {
      if (route && !METHODS.includes(name)) continue;
      const kind = route ? 'route' : 'action';
      if (admin) entries.push(route ? { kind, path, method: name } : { kind, path, export: name });
      actionEntries.push({ kind, path, name, admin: admin && !route, fn, body: fn?.body ?? null, locals: decls.locals });
    }
  }
  entries.sort((a, b) => `${a.path}${a.method ?? a.export ?? ''}`.localeCompare(`${b.path}${b.method ?? b.export ?? ''}`));
  return { entries, actionEntries, unknown };
}

/** The function of one export (`default` for a page), with the file's locals. */
export function entryFunction(path, src, name) {
  const { locals, exported } = declarations(parse(path, src));
  return { fn: exported.find((e) => e.name === name)?.fn ?? null, locals };
}

// ---------------------------------------------------------------------------
// Guard first

/**
 * @typedef {{ call: string, permission?: string, argText?: string, sync?: boolean, via?: Guard }} Guard
 * `call`: the guard function. `permission`: its first argument must be this
 * string, or an object with `permission: '<this>'`. `argText`: its first
 * argument must be exactly this source text. `sync`: a plain boolean check
 * (no await needed). `via`: `call` is a function of the same file that must
 * itself run `via` first (users/actions.ts `run()` → requireAdmin).
 */

/** Names bound by the function's parameters (`{ params }`, `request`, …). */
function paramNames(fn) {
  const names = new Set();
  const add = (b) => {
    if (ts.isIdentifier(b)) names.add(b.text);
    else for (const el of b.elements) if (!ts.isOmittedExpression(el)) add(el.name);
  };
  for (const p of fn.parameters) add(p.name);
  return names;
}

/** First call to `name` in `node`, not counting nested functions (they do not run here). */
function firstCall(node, name) {
  let found = null;
  const visit = (n) => {
    if (found || (n !== node && isFunctionLike(n))) return;
    if (ts.isCallExpression(n) && calleeName(n) === name) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

const short = (sf, node) => node.getText(sf).replace(/\s+/g, ' ').slice(0, 80);

/** Why `node`, which runs before the guard, is not allowed there; null if it is. */
function preGuardProblem(node, params, sf) {
  let problem = null;
  const visit = (n) => {
    if (problem) return;
    if (isFunctionLike(n) || ts.isClassLike(n)) {
      problem = `defines a function before the guard (\`${short(sf, n)}\`)`;
      return;
    }
    if (ts.isAwaitExpression(n)) {
      const e = unwrapTypes(n.expression);
      const preGuardCall = ts.isCallExpression(e) && ts.isIdentifier(e.expression) && PRE_GUARD_CALLS.includes(e.expression.text);
      const propsPromise = ts.isIdentifier(e) && params.has(e.text);
      if (!preGuardCall && !propsPromise) {
        problem = `awaits \`${short(sf, n)}\` before the guard`;
        return;
      }
    }
    if (ts.isForOfStatement(n) && n.awaitModifier) problem = `\`for await\` before the guard`;
    else if (ts.isYieldExpression(n)) problem = `yields before the guard`;
    else if (ts.isVariableDeclarationList(n) && ts.NodeFlags.AwaitUsing && (n.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing) {
      problem = `\`await using\` before the guard`;
    }
    if (!problem) ts.forEachChild(n, visit);
  };
  visit(node);
  return problem;
}

/** Whether `node` awaits anything outside nested functions. */
function awaitsOutsideFunctions(node) {
  let found = false;
  const visit = (n) => {
    if (found || isFunctionLike(n)) return;
    if (ts.isAwaitExpression(n)) found = true;
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function permissionProblem(call, guard, sf) {
  const arg = call.arguments[0];
  if (guard.argText !== undefined && arg?.getText(sf) !== guard.argText) {
    return `calls ${guard.call}(${arg ? arg.getText(sf) : ''}) instead of ${guard.call}(${guard.argText})`;
  }
  if (guard.permission === undefined) return null;
  const literal = (e) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined);
  let value = literal(arg);
  if (value === undefined && arg && ts.isObjectLiteralExpression(arg)) {
    const prop = arg.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'permission');
    value = prop ? literal(prop.initializer) : undefined;
  }
  return value === guard.permission ? null : `calls ${guard.call}() without '${guard.permission}' as its permission`;
}

/** Checks the statement (or concise arrow body) that holds the guard call. */
function guardStatementProblem(holder, call, guard, sf, locals) {
  let expr;
  let returned = false;
  if (ts.isExpressionStatement(holder) || ts.isIfStatement(holder)) expr = holder.expression;
  else if (ts.isReturnStatement(holder)) [expr, returned] = [holder.expression, true];
  else if (ts.isVariableStatement(holder) && holder.declarationList.declarations.length === 1) {
    expr = holder.declarationList.declarations[0].initializer;
  } else if (ts.isExpression(holder)) [expr, returned] = [holder, true]; // concise arrow body
  const shapes = `\`const x = await ${guard.call}(…)\`, \`await ${guard.call}(…)\`, \`return ${guard.call}(…)\` or \`if (!${guard.call}(…))\``;
  if (!expr) return `${guard.call}() must be a statement of its own: ${shapes}`;

  let awaited = false;
  for (;;) {
    expr = unwrapTypes(expr);
    if (ts.isAwaitExpression(expr)) [expr, awaited] = [expr.expression, true];
    else if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) expr = expr.operand;
    else if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) expr = expr.right;
    else break;
  }
  if (expr !== call) return `${guard.call}() is inside another expression (\`${short(sf, holder)}\`); write it as ${shapes}`;
  if (!guard.sync && !awaited && !returned) return `${guard.call}() is not awaited, so a failed check does not stop the function`;
  if (call.arguments.some((a) => ts.isAwaitExpression(a) || awaitsOutsideFunctions(a))) {
    return `awaits inside the ${guard.call}() arguments, before the guard`;
  }
  const perm = permissionProblem(call, guard, sf);
  if (perm) return perm;
  if (guard.via) {
    const inner = functionOf(locals, guard.call);
    if (!inner) return `cannot see ${guard.call}() in this file to check that it runs ${guard.via.call}() first`;
    const problem = guardFirstProblem(inner, guard.via, locals);
    if (problem) return `${guard.call}(): ${problem}`;
  }
  return null;
}

/**
 * Guard first: the entry's guard must run before anything else that can
 * touch data. The rule, kept small on purpose:
 *
 * 1. The guard is a statement of its own at the top level of the body (or of
 *    a `try` block there): `const x = await guard(…)`, `x = await guard(…)`,
 *    `await guard(…)`, `return guard(…)` or `if (!guard(…))` (a sync guard
 *    like isCronAuthorized). An async guard must be awaited or returned. Its
 *    arguments may not await.
 * 2. Every statement before it awaits nothing, except:
 *    - `await assertNotBlocked()` (PRE_GUARD_CALLS): the visitor block check
 *      runs before auth on purpose (T-27), and
 *    - `await <parameter>`, e.g. `await params` / `await searchParams`: the
 *      Next.js props promise, no I/O.
 *    No `for await`, `yield` or nested function either.
 *    Sync code is allowed (`if (blocked) return …`, header checks, input
 *    parsing): all data access here (Firestore, R2, Auth) is async, so it
 *    cannot happen before the guard without an await. A fire-and-forget
 *    promise from a sync call is not caught; reviews cover that.
 * 3. A `catch` or `finally` around or before the guard can run before it
 *    (when a pre-guard statement throws), so it follows rule 2 too.
 *
 * @param {ts.SignatureDeclaration | null} fn
 * @param {Guard} guard
 * @param {Map<string, ts.Node>} locals
 * @returns {string | null} why the rule is broken, or null
 */
export function guardFirstProblem(fn, guard, locals) {
  if (!fn?.body) return 'not a plain function, so the guard order cannot be seen; write it as one';
  const sf = fn.getSourceFile();
  const params = paramNames(fn);
  if (!ts.isBlock(fn.body)) {
    const call = firstCall(fn.body, guard.call);
    return call ? guardStatementProblem(fn.body, call, guard, sf, locals) : `does not call ${guard.call}()`;
  }

  const FOUND = Symbol('found');
  const walk = (statements) => {
    for (const stmt of statements) {
      if (ts.isTryStatement(stmt)) {
        const inner = walk(stmt.tryBlock.statements);
        for (const block of [stmt.catchClause?.block, stmt.finallyBlock]) {
          const problem = block && preGuardProblem(block, params, sf);
          if (problem) return `${problem} (in a catch/finally that can run before the guard)`;
        }
        if (inner) return inner;
        continue;
      }
      if (ts.isBlock(stmt)) {
        const inner = walk(stmt.statements);
        if (inner) return inner;
        continue;
      }
      const call = firstCall(stmt, guard.call);
      if (!call) {
        const problem = preGuardProblem(stmt, params, sf);
        if (problem) return problem;
        continue;
      }
      return guardStatementProblem(stmt, call, guard, sf, locals) ?? FOUND;
    }
    return null;
  };
  const result = walk(fn.body.statements);
  if (result === FOUND) return null;
  return result ?? `does not call ${guard.call}() as a top-level statement`;
}
