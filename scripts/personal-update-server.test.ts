// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { createPersonalUpdateServer } from "./personal-update-server.ts";

const request = (
  port: number,
  pathname: string,
  headers: NodeHttp.OutgoingHttpHeaders = {},
  method = "GET",
) =>
  new Promise<{ status: number; headers: NodeHttp.IncomingHttpHeaders; body: Buffer }>(
    (resolve, reject) => {
      const req = NodeHttp.request(
        { host: "127.0.0.1", port, path: pathname, headers, method },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    },
  );

const withServer = async (root: string, run: (port: number) => Promise<void>) => {
  const server = createPersonalUpdateServer({ root, host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

it("serves update manifests and supports byte ranges for ZIP artifacts", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "personal-update-server-"));
  try {
    const manifest = "version: 0.1.5-personal.1\n";
    const zip = Buffer.from("0123456789");
    NodeFS.writeFileSync(NodePath.join(root, "latest-mac.yml"), manifest);
    NodeFS.writeFileSync(NodePath.join(root, "T3-Code-personal-arm64.zip"), zip);

    await withServer(root, async (port) => {
      const manifestResponse = await request(port, "/latest-mac.yml");
      expect(manifestResponse.status).toBe(200);
      expect(manifestResponse.body.toString()).toBe(manifest);

      const headResponse = await request(port, "/latest-mac.yml", {}, "HEAD");
      expect(headResponse.status).toBe(200);
      expect(headResponse.body).toHaveLength(0);
      expect(headResponse.headers["content-length"]).toBe(String(Buffer.byteLength(manifest)));

      const rangeResponse = await request(port, "/T3-Code-personal-arm64.zip", {
        Range: "bytes=2-5",
      });
      expect(rangeResponse.status).toBe(206);
      expect(rangeResponse.headers["content-range"]).toBe("bytes 2-5/10");
      expect(rangeResponse.body.toString()).toBe("2345");
      expect(rangeResponse.headers["accept-ranges"]).toBe("bytes");

      const suffixRange = await request(port, "/T3-Code-personal-arm64.zip", {
        Range: "bytes=-3",
      });
      expect(suffixRange.status).toBe(206);
      expect(suffixRange.headers["content-range"]).toBe("bytes 7-9/10");
      expect(suffixRange.body.toString()).toBe("789");

      const openEndedRange = await request(port, "/T3-Code-personal-arm64.zip", {
        Range: "bytes=7-",
      });
      expect(openEndedRange.status).toBe(206);
      expect(openEndedRange.body.toString()).toBe("789");

      const invalidRange = await request(port, "/T3-Code-personal-arm64.zip", {
        Range: "bytes=8-2",
      });
      expect(invalidRange.status).toBe(416);

      const outOfBoundsRange = await request(port, "/T3-Code-personal-arm64.zip", {
        Range: "bytes=10-",
      });
      expect(outOfBoundsRange.status).toBe(416);
    });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("rejects traversal and symlink targets outside the feed root", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "personal-update-server-root-"));
  const outside = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "personal-update-server-outside-"),
  );
  try {
    NodeFS.writeFileSync(NodePath.join(outside, "secret.yml"), "secret\n");
    NodeFS.symlinkSync(NodePath.join(outside, "secret.yml"), NodePath.join(root, "escape.yml"));

    await withServer(root, async (port) => {
      const traversal = await request(port, "/%2e%2e%2fsecret.yml");
      expect(traversal.status).toBe(404);
      const symlink = await request(port, "/escape.yml");
      expect(symlink.status).toBe(404);
    });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
    NodeFS.rmSync(outside, { recursive: true, force: true });
  }
});
