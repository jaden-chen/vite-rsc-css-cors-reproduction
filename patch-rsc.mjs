import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";

// Apply only the two runtime changes proposed by vite-plugin-react PR #1469.
// Restore dependency source after building, including when the build fails.
export async function applyProposedPatch() {
  const directory = new URL(
    "./node_modules/@vitejs/plugin-rsc/dist/",
    import.meta.url,
  );
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", directory), "utf8"),
  );
  assert.equal(packageJson.version, "0.5.34");
  const plugins = (await readdir(directory)).filter((name) =>
    /^plugin-.*\.js$/.test(name),
  );
  assert.equal(plugins.length, 1);
  const edits = [
    [
      plugins[0],
      'rel: "stylesheet",\n\t\t\t\t...precedence',
      'rel: "stylesheet",\n\t\t\t\tcrossOrigin: "anonymous",\n\t\t\t\t...precedence',
    ],
    [
      "ssr.js",
      'ReactDOM.preinit(href, {\n\t\tas: "style",',
      'ReactDOM.preinit(href, {\n\t\tas: "style",\n\t\tcrossOrigin: "anonymous",',
    ],
  ];
  const originals = [];
  for (const [name, original, replacement] of edits) {
    const filename = new URL(name, directory);
    const source = await readFile(filename, "utf8");
    assert.equal(
      source.split(original).length,
      2,
      `Expected unpatched source: ${name}`,
    );
    originals.push({
      filename,
      source,
      modified: source.replace(original, replacement),
    });
  }
  const restore = async () => {
    for (const { filename, source } of originals)
      await writeFile(filename, source);
  };
  try {
    for (const { filename, modified } of originals)
      await writeFile(filename, modified);
  } catch (error) {
    await restore();
    throw error;
  }
  return restore;
}
