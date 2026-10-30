# Personal macOS releases

Personal builds use a local update feed; they do not upload artifacts to GitHub Releases.
Use the project action **Build & Publish Personal Release**, or run:

```sh
vp run personal:release
```

Run from a clean `personal` checkout matching `origin/personal`. The command fetches the branch
but does not pull, switch branches, create a worktree, or reinstall dependencies. It reuses
installed dependencies and build caches. Run `vp i` after a lockfile change when needed.

The command builds and signs the DMG and updater ZIP with the persistent personal identity,
verifies the signature, certificate, version, feed and checksums, then copies the artifacts to
`~/Library/Application Support/T3CodePersonalUpdates`. It publishes `latest-mac.yml` last through
an atomic rename, so an incomplete build never replaces the current feed. Previous artifacts
remain available for pending downloads. Installers also remain under
`~/Downloads/T3Code-Personal/release-<version>`.

The update feed is `http://127.0.0.1:17890/`, reachable only on this Mac. The release command sets
up a user LaunchAgent to serve it independently of the app and its server. It starts at login;
T3 Code's existing update controls check and install from this feed. To repair or recreate the
service after moving this checkout or changing the Node installation, run:

```sh
vp run personal:updates:setup
```

Keep this checkout and the Node installation available. Logs are under
`~/Library/Logs/T3CodePersonalUpdates`; the agent is
`~/Library/LaunchAgents/com.nfrid.t3code.personal-updates.plist`. To stop it:

```sh
launchctl bootout "gui/$(id -u)/com.nfrid.t3code.personal-updates"
```

To stop automatic startup as well, move that plist out of `~/Library/LaunchAgents`.
Other Macs cannot use this loopback feed.

Only one release can run per checkout. Its PID is recorded in `.t3/personal-release.lock/pid`.
If a process is forcibly killed, inspect that PID and build manifest changes before removing a
stale lock. Ordinary failures restore the keychain search list and delete the temporary keychain.
The command does not launch, replace, or restart the installed app.

## Signing and installation

Set up signing once on the Mac that uses the fork:

```sh
vp run personal:signing
```

This reuses or creates a persistent self-signed certificate and asks macOS to trust it for code
signing. Keep a private backup of `~/.config/t3code-personal-signing` (or the configured
`XDG_CONFIG_HOME` directory). Never commit the private key or password. Replacing the identity
breaks update continuity. This does not provide Apple notarization or provisioned passkeys.

The first build with the local feed needs a manual installation: wait for active local turns to
finish, quit T3 Code, open the generated DMG, and replace `/Applications/T3 Code (Beta).app`.
The profile remains the same. Later builds use the app's update controls. Do not edit an installed
app's `app-update.yml`; doing so invalidates its signature.

Versions retain the upstream base and append a counter: `0.1.5-personal.1`, `.2`, and so on.
The next counter includes existing installer directories, the installed app, and the local feed.
Failed build directories reserve their version. Preserve these when moving the release setup;
GitHub Releases are no longer consulted. A new upstream base restarts the counter at one.
Do not use `+personal.N`: SemVer comparison ignores build metadata.

## CI

**Personal CI** runs one standard GitHub Linux job on PRs into `personal`: changed-file format/lint,
web/desktop/tooling typechecks, and focused release/feed/highlighting tests. Other imported workflows
remain disabled in the fork's Actions settings. No Actions workflow publishes personal releases.
This does not replace upstream's server/mobile/platform matrices; validate those changes locally
when merging upstream. Merging upstream remains a separate task from building a release.

## Remove signing trust

```sh
security remove-trusted-cert "$HOME/.config/t3code-personal-signing/certificate.pem"
```

Use the configured `XDG_CONFIG_HOME` path if applicable. Removing trust can prevent future
self-signed updates from validating; it does not delete the certificate backup.

## Keychain prompts after updates

`t3code Safe Storage` holds Electron's encryption key. macOS applies both the app's designated
requirement and a separate keychain partition check. Self-signed builds get a `cdhash:` partition,
which changes with each build even when the signing certificate stays the same. An approval
for one version therefore does not cover every future version. Keep the signing identity stable
and approve the prompt for each updated build. Do not delete this key: existing encrypted data
needs it. See Apple's [partition selection](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp)
and [partition validation](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/acls.cpp).
