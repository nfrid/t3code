# Personal macOS releases

This fork publishes Apple Silicon builds to GitHub Releases for the installed app's update controls.
Use the project action **Build & Publish Personal Release** in T3 Code, or build and publish
from a clean `personal` checkout:

```sh
vp run personal:release
```

The checkout must match `origin/personal`. The command fetches that branch to check it but does
not pull, switch branches, create a worktree, or reinstall dependencies. Run `vp i` yourself if
dependencies have not been installed for the current lockfile. It reuses build caches and writes
artifacts to `~/Downloads/T3Code-Personal/release-<version>`.

The command imports the existing signing identity into a temporary keychain, builds the DMG and
updater ZIP, checks the bundle identity, strict signature, pinned certificate, update feed, and
artifact hashes, then uploads a draft release and publishes it after all uploads finish. It does
not launch, replace, or restart the installed app. A failed upload can leave a draft for inspection;
its version stays reserved. Delete that draft only if you intend to reuse the version.

Only one local release can run per checkout. Its PID is recorded in
`.t3/personal-release.lock/pid`. If a process is forcibly killed, inspect that PID and any build
manifest changes before removing the stale lock. Ordinary failures restore the keychain search
list and remove the temporary keychain.

The **Personal macOS release** Actions workflow is a manual fallback on `personal`; pushes no
longer trigger a competing release. **Personal CI** runs one Linux job on PRs targeting `personal`:
changed-file format/lint, web/desktop/tooling typechecks, and focused release/highlighting tests.
It does not replace upstream's server, mobile, or platform test matrices; validate changes in
those areas locally when merging upstream. The fork disables the other imported workflows in
GitHub Actions settings, keeping their files for future upstream merges. All runner labels use
standard GitHub-hosted machines. Neither personal release path publishes npm packages or deploys
the upstream websites.

## Set up signing once

On the Mac that will use the fork, run:

```sh
vp run personal:signing
```

The command creates a persistent self-signed certificate, uploads its encrypted identity and
password to the fork's Actions secrets, and asks macOS to trust the certificate for code signing.
Keep a private backup of `~/.config/t3code-personal-signing` (or the directory under
`XDG_CONFIG_HOME` if configured). The private key and password must never be committed.
Rerunning the command reuses the identity; replacing it would break update continuity.

This is personal signing, without Apple notarization or provisioned passkeys. Downloaded builds
can still require macOS's first-launch approval. Other Macs need the same public certificate
trusted for code signing; they do not need the private key or its password.

## Install the first release

Download the DMG from this fork's GitHub Releases. Wait for active local agent turns to finish,
quit T3 Code, back up `~/.t3` and `~/Library/Application Support/t3code-v2`, and replace
`/Applications/T3 Code (Beta).app` with the signed release. The first manual replacement installs
both the persistent signing identity and the fork's updater feed into the app.

Subsequent releases appear in the app's existing update controls. Install them when restarting
the local server is convenient. The workflow builds on GitHub and does not interrupt running
threads on this Mac. Upstream changes still need to be merged into `personal`; publishing does
not merge them automatically.

Versions retain the upstream manifest's version and append a fork counter: upstream `0.1.5`
becomes `0.1.5-personal.1`, then `0.1.5-personal.2`. When upstream becomes `0.1.6`, the counter
starts at `0.1.6-personal.1`. Both release paths count existing drafts as reserved versions.
Build manifests are restored after packaging; releases do not create version-only commits.

These are published as regular GitHub Releases on this fork's `latest` feed, with
`latest-mac.yml`; the personal suffix does not select a separate updater channel. The publisher
explicitly marks each release latest, including the initial migration to the suffix scheme.
The fork's feed and repository are separate from upstream's.

The old personal `0.1.6` is newer in SemVer order than `0.1.5-personal.1`. Install the first
suffix release manually once, retaining the same certificate and profile. Later personal
counters and newer upstream bases update normally. Do not use `+personal.N` build metadata:
SemVer comparison ignores that counter, so it cannot drive updates.

## Remove trust

To remove this certificate's code-signing trust:

```sh
security remove-trusted-cert "$HOME/.config/t3code-personal-signing/certificate.pem"
```

Use the configured `XDG_CONFIG_HOME` path instead if applicable. Removing trust can prevent
future self-signed updates from validating. It does not delete the certificate backup or
the GitHub Actions secrets.
