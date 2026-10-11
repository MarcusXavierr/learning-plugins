// Run with Node 24's type stripping: `node build/cli.ts <command>`. Erasable syntax only.
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadPluginSource } from "./plugin-source.ts";
import { buildTree, listFiles } from "./plugin-tree.ts";
import { buildRepo, diffRepo, writeRepo } from "./repo.ts";

const root = resolve(import.meta.dirname, "..");
const [command, ...args] = process.argv.slice(2);

/** Vendored from what CC writes into `<plugin>/.claude-plugin/types/`; claude-code-mcp is machine-specific, so not vendored. */
const CLAUDE_TYPE_FILES = ["claude-code/index.d.ts", "claude-code-tools/index.d.ts"];
const FIXTURE = join(root, "build/test/fixtures/repo/plugins/alpha");

function run(cmd: string, argv: string[]): boolean {
  // eslint-disable-next-line llm-core/structured-logging -- CLI echoes the exact command for humans, not aggregate logs.
  console.log(`$ ${cmd} ${argv.join(" ")}`);
  return spawnSync(cmd, argv, { cwd: root, stdio: "inherit" }).status === 0;
}

async function subdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** Stage the actual built tree, optionally copying the CC tests, without touching committed dist/. */
async function stageClaude(source: string, name: string, withTests: boolean): Promise<string> {
  const dir = source === FIXTURE ? join(root, ".test-build/fixtures/alpha") : join(root, ".test-build/claude", name);
  await rm(dir, { recursive: true, force: true });
  for (const [path, content] of await buildTree(await loadPluginSource(source), "claude")) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  if (withTests) {
    const testDir = join(source, "test/claude");
    for (const file of await listFiles(testDir)) {
      await mkdir(dirname(join(dir, "test/claude", file)), { recursive: true });
      await copyFile(join(testDir, file), join(dir, "test/claude", file));
    }
  }
  return dir;
}

switch (command) {
  case "build": {
    await writeRepo(root, await buildRepo(root));
    console.log("wrote dist/ and both catalogs");
    break;
  }
  case "check": {
    const problems = await diffRepo(root, await buildRepo(root));
    if (problems.length > 0) {
      // eslint-disable-next-line llm-core/structured-logging -- Freshness diagnostics must name each generated file.
      console.error(`${problems.join("\n")}\n\ngenerated files are out of date: run \`npm run build\``);
      process.exitCode = 1;
    }
    break;
  }
  case "validate": {
    // CC rejects an empty marketplace, but the persistent fixture always validates the built bundle.
    const plugins = (await subdirs(join(root, "dist/claude"))).map((name) => join(root, "dist/claude", name));
    const fixture = await stageClaude(FIXTURE, "alpha-fixture", false);
    if (plugins.length === 0) console.log("no plugins in dist/claude: validating fixture only");
    const dirs = [...(plugins.length > 0 ? [root, ...plugins] : []), fixture];
    const failed = dirs.filter((dir) => !run("claude", ["plugin", "validate", "--strict", dir]));
    if (failed.length > 0) {
      // eslint-disable-next-line llm-core/structured-logging -- CLI diagnostics enumerate failing plugin directories.
      console.error(`validate --strict failed for:\n${failed.join("\n")}`);
      process.exitCode = 1;
    }
    break;
  }
  case "test-claude": {
    const all = await subdirs(join(root, "plugins"));
    const withTests: string[] = [];
    for (const name of all) if ((await listFiles(join(root, "plugins", name, "test/claude"))).length > 0) withTests.push(name);
    const names = args.length > 0 ? args : ["alpha-fixture", ...withTests];
    const failed: string[] = [];
    for (const name of names) {
      const source = name === "alpha-fixture" ? FIXTURE : join(root, "plugins", name);
      if (name !== "alpha-fixture" && !withTests.includes(name)) throw new Error(`plugins/${name}/test/claude has no CC tests`);
      const dir = await stageClaude(source, name, true);
      if (!run("claude", ["plugin", "test", dir])) failed.push(name);
    }
    if (failed.length > 0) {
      // eslint-disable-next-line llm-core/structured-logging -- CLI diagnostics enumerate failing plugin tests.
      console.error(`claude plugin test failed for: ${failed.join(", ")}`);
      process.exitCode = 1;
    }
    break;
  }
  case "refresh-claude-types": {
    const pluginDir = args.at(0);
    if (pluginDir === undefined) throw new Error("usage: npm run types:claude -- <plugin dir CC loaded with --plugin-dir>");
    const from = join(resolve(pluginDir), ".claude-plugin/types");
    for (const file of CLAUDE_TYPE_FILES) {
      await mkdir(dirname(join(root, "types/claude-code", file)), { recursive: true });
      await copyFile(join(from, file), join(root, "types/claude-code", file));
    }
    const header = (await readFile(join(root, "types/claude-code", CLAUDE_TYPE_FILES.at(0) ?? ""), "utf8")).split("\n", 1).at(0);
    // eslint-disable-next-line llm-core/structured-logging -- CLI reports the precise vendored type header.
    console.log(`types/claude-code refreshed: ${header}`);
    break;
  }
  default:
    console.error("usage: node build/cli.ts build | check | validate | test-claude [plugin…] | refresh-claude-types <dir>");
    process.exitCode = 2;
}
