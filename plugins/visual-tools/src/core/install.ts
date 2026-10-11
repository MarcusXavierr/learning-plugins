/** Where the renderer's npm dependencies live, and how long a render may take. Pure. */

interface CacheEnv {
  XDG_CACHE_HOME?: string | undefined;
  HOME?: string | undefined;
}

export interface InstallPaths {
  /** 16 lowercase hex chars: FNV-1a 64 of the lockfile text. */
  hash: string;
  /** `<cache>/learning-plugins/visual-tools/<hash>` */
  dir: string;
  /** `<dir>/.installed`: written last, so its presence means the install completed. */
  marker: string;
}

const INSTALL_TIMEOUT_MS = 600_000;
const RENDER_TIMEOUT_MS = 120_000;

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;
/** FNV-1a 64 yields 64 bits, i.e. 16 hex digits, zero-padded. */
const HASH_HEX_LENGTH = 16;

/** FNV-1a 64 over UTF-16 code units. Deterministic in every JS runtime (no crypto API needed). */
function lockHash(lockText: string): string {
  let h = FNV64_OFFSET;
  for (let i = 0; i < lockText.length; i++) {
    h ^= BigInt(lockText.charCodeAt(i));
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h.toString(HASH_HEX_LENGTH).padStart(HASH_HEX_LENGTH, "0");
}

/** `${XDG_CACHE_HOME:-$HOME/.cache}/learning-plugins/visual-tools`. A relative XDG_CACHE_HOME is ignored (XDG spec). */
export function cacheRoot(env: CacheEnv): string {
  const xdg = env.XDG_CACHE_HOME;
  if (xdg !== undefined && xdg.startsWith("/")) return `${xdg.replace(/\/+$/, "")}/learning-plugins/visual-tools`;
  const home = env.HOME;
  if (home === undefined || !home.startsWith("/")) {
    throw new Error("Cannot locate a cache directory: set HOME or an absolute XDG_CACHE_HOME.");
  }
  return `${home.replace(/\/+$/, "")}/.cache/learning-plugins/visual-tools`;
}

export function installPaths(lockText: string, env: CacheEnv): InstallPaths {
  const hash = lockHash(lockText);
  const dir = `${cacheRoot(env)}/${hash}`;
  return { hash, dir, marker: `${dir}/.installed` };
}

/** A render that may have to install first gets the install budget. */
export function renderTimeoutMs(installed: boolean): number {
  return installed ? RENDER_TIMEOUT_MS : INSTALL_TIMEOUT_MS;
}
