import { guardOf } from '../../src/core/authz/index.js';

const joinPath = (prefix, path) =>
  `${prefix}/${path ?? ''}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

/**
 * Every route of an app with the guards that run before its handler, in order (router-level
 * `use()` guards included).
 * @param {import('express').Express} app
 * @returns {Array<{ route: string, guards: string[] }>}
 */
export function listRoutes(app) {
  const routes = [];
  const walk = (stack, prefix, inherited) => {
    let active = inherited;
    for (const layer of stack) {
      if (layer.route) {
        const path = joinPath(prefix, layer.route.path);
        const guards = [...active, ...layer.route.stack.map((l) => guardOf(l.handle))].filter(
          Boolean,
        );
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ route: `${method.toUpperCase()} ${path}`, guards });
        }
      } else if (Array.isArray(layer.handle?.stack)) {
        walk(layer.handle.stack, joinPath(prefix, layer.rawPath), active);
      } else if (guardOf(layer.handle)) {
        active = [...active, guardOf(layer.handle)];
      }
    }
  };
  walk(app.router.stack, '', []);
  return routes;
}
