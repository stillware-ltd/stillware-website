export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const missing = err && (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "ERR_UNSUPPORTED_DIR_IMPORT");
    if (missing && /^\.{1,2}\//.test(specifier) && specifier.endsWith(".js")) {
      return nextResolve(specifier.slice(0, -3) + ".ts", context);
    }
    throw err;
  }
}
