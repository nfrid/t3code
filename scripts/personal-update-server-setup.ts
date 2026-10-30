// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { personalUpdateDirectory } from "./personal-update-server.ts";

const label = "com.nfrid.t3code.personal-updates";
const repositoryRoot = NodePath.dirname(import.meta.dirname);
const serverScript = NodePath.join(repositoryRoot, "scripts", "personal-update-server.ts");
const logDirectory = NodePath.join(NodeOS.homedir(), "Library", "Logs", "T3CodePersonalUpdates");
const agentDirectory = NodePath.join(NodeOS.homedir(), "Library", "LaunchAgents");
const agentPath = NodePath.join(agentDirectory, `${label}.plist`);

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function writeAgentPlist() {
  const argumentsXml = [process.execPath, serverScript]
    .map((argument) => `    <string>${xml(argument)}</string>`)
    .join("\n");
  const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(NodePath.join(logDirectory, "server.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(NodePath.join(logDirectory, "server.error.log"))}</string>
</dict>
</plist>
`;
  const temporaryPath = `${agentPath}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporaryPath, contents, { mode: 0o600 });
  NodeFS.renameSync(temporaryPath, agentPath);
  NodeFS.chmodSync(agentPath, 0o600);
}

function launchctl(args: string[]) {
  NodeChildProcess.execFileSync("/bin/launchctl", args, { stdio: "ignore" });
}

export function setupPersonalUpdateServer() {
  if (Effect.runSync(HostProcess.Platform) !== "darwin") {
    throw new Error("The personal update server LaunchAgent requires macOS.");
  }
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Could not determine the current user ID.");
  const domain = `gui/${uid}`;
  const service = `${domain}/${label}`;

  NodeFS.mkdirSync(personalUpdateDirectory, { recursive: true, mode: 0o700 });
  NodeFS.chmodSync(personalUpdateDirectory, 0o700);
  NodeFS.mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  NodeFS.chmodSync(logDirectory, 0o700);
  NodeFS.mkdirSync(agentDirectory, { recursive: true, mode: 0o700 });
  writeAgentPlist();

  const loaded = NodeChildProcess.spawnSync("/bin/launchctl", ["print", service], {
    stdio: "ignore",
  });
  if (loaded.error) throw loaded.error;
  if (loaded.status === 0) launchctl(["kickstart", service]);
  else launchctl(["bootstrap", domain, agentPath]);

  return { directory: personalUpdateDirectory, url: "http://127.0.0.1:17890/", agentPath };
}

if (import.meta.main) {
  const configured = setupPersonalUpdateServer();
  process.stdout.write(`Personal update server ready at ${configured.url}\n`);
}
