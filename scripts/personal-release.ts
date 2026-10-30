// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromYaml } from "@t3tools/shared/schemaYaml";

const repository = "nfrid/t3code";
const root = NodePath.dirname(import.meta.dirname);
export function nextPersonalVersion(base: string, tags: ReadonlyArray<string>) {
  if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error(`Expected a plain upstream version: ${base}`);
  const prefix = `${base}-personal.`;
  const counters = tags
    .map((tag) => tag.replace(/^v/, ""))
    .flatMap((version) => {
      if (!version.startsWith(prefix)) return [];
      const counter = version.slice(prefix.length);
      return /^[1-9]\d*$/.test(counter) ? [Number(counter)] : [];
    });
  return `${prefix}${Math.max(0, ...counters) + 1}`;
}

const Manifest = fromYaml(
  Schema.Struct({
    version: Schema.String,
    files: Schema.Array(Schema.Struct({ url: Schema.String, sha512: Schema.String })),
  }),
);
const Feed = fromYaml(
  Schema.Struct({ provider: Schema.String, owner: Schema.String, repo: Schema.String }),
);
const decodeReleasePages = Schema.decodeUnknownSync(
  Schema.Array(Schema.Array(Schema.Struct({ tag_name: Schema.String }))),
);
const decodeDesktopVersion = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }));
const decodeManifest = Schema.decodeSync(Manifest);
const decodeFeed = Schema.decodeSync(Feed);

export function verifyPersonalManifest(source: string, version: string, directory: string) {
  const manifest = decodeManifest(source);
  if (manifest.version !== version) throw new Error("Update manifest version does not match.");
  const expected = [`T3-Code-${version}-arm64.dmg`, `T3-Code-${version}-arm64.zip`];
  if (manifest.files.length !== expected.length) throw new Error("Unexpected update artifacts.");
  for (const filename of expected) {
    const entry = manifest.files.find((file) => file.url === filename);
    if (!entry) throw new Error(`Missing updater artifact: ${filename}`);
    const digest = NodeCrypto.createHash("sha512")
      .update(NodeFS.readFileSync(NodePath.join(directory, filename)))
      .digest("base64");
    if (digest !== entry.sha512) throw new Error(`Artifact checksum does not match: ${filename}`);
  }
  return expected;
}

export function verifyPersonalSigningRequirement(
  requirement: { status: number | null; stdout: string; stderr: string },
  leaf: Uint8Array,
) {
  const fingerprint = NodeCrypto.createHash("sha1").update(leaf).digest("hex");
  if (
    requirement.status !== 0 ||
    !requirement.stdout.toLowerCase().includes(`certificate leaf = h"${fingerprint}"`)
  )
    throw new Error("App does not pin the signing certificate.");
}

async function release() {
  const [platform, architecture] = Effect.runSync(
    Effect.all([HostProcess.Platform, HostProcess.Architecture]),
  );
  if (platform !== "darwin" || architecture !== "arm64") {
    throw new Error("Personal releases require an Apple Silicon Mac.");
  }
  const env = { ...process.env };
  delete env.ABBR_TIPS_PROMPT;
  delete env.ELECTRON_RUN_AS_NODE;
  const command = (program: string, args: string[], cwd = root, sensitive = false) => {
    const result = NodeChildProcess.spawnSync(program, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: program === "gh" && args[0] === "release" ? 600_000 : 30_000,
    });
    if (result.status !== 0) {
      throw new Error(`${program} ${args[0]} failed.${sensitive ? "" : ` ${result.stderr ?? ""}`}`);
    }
    return result.stdout.trim();
  };
  const assertCheckout = () => {
    if (command("git", ["branch", "--show-current"]) !== "personal") {
      throw new Error("Switch to personal before releasing; the current checkout is reused.");
    }
    if (command("git", ["status", "--porcelain"])) throw new Error("The checkout must be clean.");
  };
  assertCheckout();
  command("git", ["fetch", "origin", "personal"]);
  const commit = command("git", ["rev-parse", "HEAD"]);
  if (command("git", ["rev-parse", "refs/remotes/origin/personal"]) !== commit) {
    throw new Error("personal must match origin/personal before releasing.");
  }
  const keychains = command("security", ["list-keychains", "-d", "user"])
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  const lock = NodePath.join(root, ".t3", "personal-release.lock");
  NodeFS.mkdirSync(NodePath.dirname(lock), { recursive: true });
  NodeFS.mkdirSync(lock);
  NodeFS.writeFileSync(NodePath.join(lock, "pid"), `${process.pid}\n`);
  const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-personal-release-"));
  const keychain = NodePath.join(temporary, "signing.keychain-db");
  const signing = NodePath.join(
    env.XDG_CONFIG_HOME ?? NodePath.join(NodeOS.homedir(), ".config"),
    "t3code-personal-signing",
  );
  const keychainPassword = NodeCrypto.randomBytes(24).toString("hex");
  let mounted = false;
  let interrupted = false;
  let activeChild: ReturnType<typeof NodeChildProcess.spawn> | undefined;
  const interrupt = () => {
    interrupted = true;
    activeChild?.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const mount = NodePath.join(temporary, "mount");
  try {
    const pages = decodeReleasePages(
      JSON.parse(command("gh", ["api", `repos/${repository}/releases`, "--paginate", "--slurp"])),
    );
    const desktop = decodeDesktopVersion(
      JSON.parse(NodeFS.readFileSync(NodePath.join(root, "apps/desktop/package.json"), "utf8")),
    );
    const version = nextPersonalVersion(
      desktop.version,
      pages.flat().map((item) => item.tag_name),
    );
    const output = NodePath.join(
      NodeOS.homedir(),
      "Downloads",
      "T3Code-Personal",
      `release-${version}`,
    );
    if (NodeFS.existsSync(output)) throw new Error(`Release output already exists: ${output}`);
    console.log(`Building ${version} from ${commit} in the current checkout.`);
    command("security", ["create-keychain", "-p", keychainPassword, keychain], root, true);
    command("security", ["unlock-keychain", "-p", keychainPassword, keychain], root, true);
    command("security", ["set-keychain-settings", "-lut", "21600", keychain]);
    command(
      "security",
      [
        "import",
        NodePath.join(signing, "identity.p12"),
        "-k",
        keychain,
        "-P",
        NodeFS.readFileSync(NodePath.join(signing, "password"), "utf8").trim(),
        "-T",
        "/usr/bin/codesign",
      ],
      root,
      true,
    );
    command(
      "security",
      [
        "set-key-partition-list",
        "-S",
        "apple-tool:,apple:,codesign:",
        "-s",
        "-k",
        keychainPassword,
        keychain,
      ],
      root,
      true,
    );
    command("security", ["list-keychains", "-d", "user", "-s", ...keychains, keychain]);
    Object.assign(
      env,
      NodeUtil.parseEnv(NodeFS.readFileSync(NodePath.join(root, ".env.example"), "utf8")),
      {
        T3CODE_MACOS_SELF_SIGNED_IDENTITY: "T3 Code Personal",
        T3CODE_MACOS_SELF_SIGNED_KEYCHAIN: keychain,
        T3CODE_DESKTOP_UPDATE_REPOSITORY: repository,
      },
    );
    await new Promise<void>((resolve, reject) => {
      activeChild = NodeChildProcess.spawn(
        "vp",
        ["run", "dist:desktop:dmg:arm64", "--build-version", version, "--output-dir", output],
        { cwd: root, env, stdio: "inherit" },
      );
      activeChild.once("error", reject);
      activeChild.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`Desktop build failed (${code}).`)),
      );
    });
    activeChild = undefined;
    if (interrupted) throw new Error("Release interrupted before publication.");
    const files = verifyPersonalManifest(
      NodeFS.readFileSync(NodePath.join(output, "latest-mac.yml"), "utf8"),
      version,
      output,
    );
    NodeFS.mkdirSync(mount);
    command("hdiutil", [
      "attach",
      NodePath.join(output, files[0]!),
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
    ]);
    mounted = true;
    const bundle = NodeFS.readdirSync(mount).find((file) => file.endsWith(".app"));
    if (!bundle) throw new Error("No app bundle in the DMG.");
    const app = NodePath.join(mount, bundle);
    command("codesign", ["--verify", "--deep", "--strict", app]);
    const info = NodePath.join(app, "Contents/Info.plist");
    if (
      command("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", info]) !==
        version ||
      command("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", info]) !==
        "com.t3tools.t3code"
    ) {
      throw new Error("App version or identity does not match.");
    }
    const feed = decodeFeed(
      NodeFS.readFileSync(NodePath.join(app, "Contents/Resources/app-update.yml"), "utf8"),
    );
    if (feed.provider !== "github" || `${feed.owner}/${feed.repo}` !== repository)
      throw new Error("App uses a different update feed.");
    command("codesign", ["-d", "--extract-certificates", app], temporary);
    command("/usr/bin/openssl", [
      "x509",
      "-in",
      NodePath.join(signing, "certificate.pem"),
      "-outform",
      "DER",
      "-out",
      NodePath.join(temporary, "expected.der"),
    ]);
    const leaf = NodeFS.readFileSync(NodePath.join(temporary, "codesign0"));
    if (!leaf.equals(NodeFS.readFileSync(NodePath.join(temporary, "expected.der"))))
      throw new Error("Signing certificate changed.");
    const requirement = NodeChildProcess.spawnSync("codesign", ["-d", "-r-", app], {
      encoding: "utf8",
    });
    verifyPersonalSigningRequirement(requirement, leaf);
    command("hdiutil", ["detach", mount]);
    mounted = false;
    assertCheckout();
    if (interrupted || command("git", ["rev-parse", "HEAD"]) !== commit)
      throw new Error("Checkout changed while building.");
    const tag = `v${version}`;
    const assets = [
      ...files,
      "latest-mac.yml",
      ...NodeFS.readdirSync(output).filter((file) => file.endsWith(".blockmap")),
    ].map((file) => NodePath.join(output, file));
    command("gh", [
      "release",
      "create",
      tag,
      ...assets,
      "--repo",
      repository,
      "--target",
      commit,
      "--draft",
      "--title",
      `T3 Code Personal ${tag}`,
      "--notes",
      `Personal macOS arm64 release from ${commit}.`,
    ]);
    if (interrupted) throw new Error("Release interrupted; uploaded draft was not published.");
    command("gh", ["release", "edit", tag, "--repo", repository, "--draft=false", "--latest"]);
    console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (mounted) NodeChildProcess.spawnSync("hdiutil", ["detach", mount], { timeout: 30_000 });
    const restored = NodeChildProcess.spawnSync(
      "security",
      ["list-keychains", "-d", "user", "-s", ...keychains],
      {
        timeout: 10_000,
      },
    );
    const removed = NodeChildProcess.spawnSync("security", ["delete-keychain", keychain], {
      timeout: 10_000,
    });
    if (restored.status === 0 && removed.status === 0)
      NodeFS.rmSync(temporary, { recursive: true, force: true });
    else console.error(`Keychain cleanup needs attention: ${temporary}`);
    NodeFS.rmSync(lock, { recursive: true, force: true });
  }
}

if (import.meta.main) await release();
