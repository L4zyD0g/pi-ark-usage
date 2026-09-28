/**
 * Resolve hook: rewrite relative `.js` specifiers to `.ts` so the NodeNext-style
 * relative imports in extensions/ resolve under node's native type stripping.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    specifier.endsWith(".js")
  ) {
    const base = context.parentURL ?? pathToFileURL(process.cwd() + "/").href;
    const tsUrl = new URL(specifier.slice(0, -3) + ".ts", base);
    if (existsSync(fileURLToPath(tsUrl))) {
      return nextResolve(tsUrl.href, context);
    }
  }
  return nextResolve(specifier, context);
}
