// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { nextPersonalVersion, verifyPersonalManifest } from "./personal-release.ts";

it("increments only the fork counter for the real upstream version, including drafts", () => {
  expect(
    nextPersonalVersion("0.1.5", [
      "v0.1.6",
      "v0.1.5-personal.1",
      "v0.1.5-personal.2",
      "v0.2.0-nightly.1",
    ]),
  ).toBe("0.1.5-personal.3");
  expect(nextPersonalVersion("0.2.0", ["v0.1.5-personal.99"])).toBe("0.2.0-personal.1");
  expect(
    nextPersonalVersion("0.1.5", [
      "v0.1.5-personal.9",
      "v0.1.5-personal.10",
      "v0.1.5-personal.broken",
    ]),
  ).toBe("0.1.5-personal.11");
  expect(() => nextPersonalVersion("broken", [])).toThrow();
});

it("refuses publishing incomplete, mismatched, or tampered update artifacts", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "personal-release-test-"));
  try {
    const files = ["T3-Code-0.1.5-personal.1-arm64.dmg", "T3-Code-0.1.5-personal.1-arm64.zip"];
    const digest = NodeCrypto.createHash("sha512").update("artifact").digest("base64");
    for (const file of files) NodeFS.writeFileSync(NodePath.join(directory, file), "artifact");
    const manifest = (urls: string[]) =>
      `version: 0.1.5-personal.1\nfiles:\n${urls.map((url) => `  - url: ${url}\n    sha512: ${digest}`).join("\n")}\n`;
    expect(verifyPersonalManifest(manifest(files), "0.1.5-personal.1", directory)).toEqual(files);
    expect(() => verifyPersonalManifest(manifest(files), "0.1.5-personal.2", directory)).toThrow(
      "version",
    );
    expect(() =>
      verifyPersonalManifest(manifest(files.slice(0, 1)), "0.1.5-personal.1", directory),
    ).toThrow("artifacts");
    expect(() =>
      verifyPersonalManifest(
        manifest([files[0]!, "../outside.zip"]),
        "0.1.5-personal.1",
        directory,
      ),
    ).toThrow("Missing");
    NodeFS.writeFileSync(NodePath.join(directory, files[1]!), "changed");
    expect(() => verifyPersonalManifest(manifest(files), "0.1.5-personal.1", directory)).toThrow(
      "checksum",
    );
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
