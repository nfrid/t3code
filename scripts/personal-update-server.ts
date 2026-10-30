// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const personalUpdateDirectory = NodePath.join(
  NodeOS.homedir(),
  "Library",
  "Application Support",
  "T3CodePersonalUpdates",
);
export const personalUpdateUrl = "http://127.0.0.1:17890/";
export const PERSONAL_UPDATE_ROOT = personalUpdateDirectory;
export const PERSONAL_UPDATE_HOST = "127.0.0.1";
export const PERSONAL_UPDATE_PORT = 17890;

const notFound = (response: NodeHttp.ServerResponse) => {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not Found");
};

function isInsideRoot(root: string, target: string): boolean {
  const relative = NodePath.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${NodePath.sep}`) && relative !== "..");
}

function resolveFile(root: string, requestUrl: string | undefined): string | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://localhost").pathname);
  } catch {
    return undefined;
  }
  if (pathname.includes("\0")) return undefined;

  const candidate = NodePath.resolve(
    root,
    `.${pathname.startsWith("/") ? pathname : `/${pathname}`}`,
  );
  if (!isInsideRoot(root, candidate)) return undefined;
  try {
    const realPath = NodeFS.realpathSync(candidate);
    if (!isInsideRoot(root, realPath) || !NodeFS.statSync(realPath).isFile()) return undefined;
    return realPath;
  } catch {
    return undefined;
  }
}

function byteRange(
  value: string | undefined,
  size: number,
): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size === 0 || (!match[1] && !match[2])) return undefined;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start >= size ||
    start > requestedEnd
  ) {
    return undefined;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function sendFile(
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
  file: string,
) {
  const stat = NodeFS.statSync(file);
  const rangeHeader = request.headers.range;
  const range = byteRange(typeof rangeHeader === "string" ? rangeHeader : undefined, stat.size);
  const headers: NodeHttp.OutgoingHttpHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type":
      file.endsWith(".yml") || file.endsWith(".yaml")
        ? "text/yaml; charset=utf-8"
        : "application/octet-stream",
  };

  if (rangeHeader && !range) {
    response.writeHead(416, { ...headers, "Content-Range": `bytes */${stat.size}` });
    response.end();
    return;
  }

  if (range) {
    const length = range.end - range.start + 1;
    const stream = request.method === "HEAD" ? undefined : NodeFS.createReadStream(file, range);
    response.writeHead(206, {
      ...headers,
      "Content-Length": length,
      "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
    });
    if (request.method === "HEAD") response.end();
    else stream?.on("error", () => response.destroy()).pipe(response);
    return;
  }

  const stream = request.method === "HEAD" ? undefined : NodeFS.createReadStream(file);
  response.writeHead(200, { ...headers, "Content-Length": stat.size });
  if (request.method === "HEAD") response.end();
  else stream?.on("error", () => response.destroy()).pipe(response);
}

export function createPersonalUpdateServer(
  options: {
    readonly root?: string;
    readonly host?: string;
    readonly port?: number;
  } = {},
): NodeHttp.Server {
  const root = NodeFS.realpathSync(options.root ?? PERSONAL_UPDATE_ROOT);
  return NodeHttp.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const file = resolveFile(root, request.url);
    if (!file) {
      notFound(response);
      return;
    }
    try {
      sendFile(request, response, file);
    } catch {
      if (response.headersSent) response.destroy();
      else notFound(response);
    }
  }).listen(options.port ?? PERSONAL_UPDATE_PORT, options.host ?? PERSONAL_UPDATE_HOST);
}

if (import.meta.main) {
  NodeFS.mkdirSync(PERSONAL_UPDATE_ROOT, { recursive: true, mode: 0o700 });
  createPersonalUpdateServer();
}
