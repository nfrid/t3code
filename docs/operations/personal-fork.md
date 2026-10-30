# Personal macOS releases

This fork builds Apple Silicon releases from `personal` with the **Personal macOS release**
GitHub Actions workflow. Each push builds a new version and publishes its DMG, updater ZIP,
and update metadata to `nfrid/t3code`. The workflow can also be run manually.
It does not publish npm packages or deploy the upstream websites.

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

The release version is the next patch after the highest plain `major.minor.patch` version in
the source manifest or this fork's published releases. Source manifests are restored after the
build; releases do not create version-only commits.

## Remove trust

To remove this certificate's code-signing trust:

```sh
security remove-trusted-cert "$HOME/.config/t3code-personal-signing/certificate.pem"
```

Use the configured `XDG_CONFIG_HOME` path instead if applicable. Removing trust can prevent
future self-signed updates from validating. It does not delete the certificate backup or
the GitHub Actions secrets.
