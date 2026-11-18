# Releasing Orrery

Every release needs the owner's yes. The script prepares and tags the commit, CI builds the package and prepares a **draft** GitHub release, and publishing that draft is the owner's yes. The crates.io upload is a separate manual step. Nothing publishes on its own. The pipeline follows crabfarm's (2026-11-19).

## Names

- crates.io package: **`orrery-viewer`** (the name `orrery` belongs to an unrelated project).
- Program: **`orrery`** / `orrery.exe` (`[[bin]]` in `Cargo.toml`), so `cargo install --locked orrery-viewer` installs `orrery.exe`.
- GitHub package: `orrery-<version>-windows-x64.zip`.

## Versions

One version, `version` under `[package]` in `Cargo.toml`, following SemVer.
- Prereleases look like `0.2.0-beta.1`. Their tags have a `-` and become GitHub prereleases; they are never published to crates.io.
- A crates.io version can never be overwritten, only yanked.

## Cutting a release

From a clean checkout of `main` that matches `origin/main`:

```powershell
./scripts/release.ps1 -Version 0.1.2 -DryRun   # reports what would stop it; changes nothing
./scripts/release.ps1 -Version 0.1.2
```

Set the public commit identity in the environment first if Git config does not already give a GitHub noreply address (`GIT_AUTHOR_*` and `GIT_COMMITTER_*`; the script never writes Git config).

The script:
1. refuses a dirty tree, a branch other than `main`, a `main` that differs from `origin/main`, an existing tag, a version that does not go up, an empty `## Unreleased` section in `CHANGELOG.md`, an `origin` that is not `https://github.com/rennerdo30/orrery`, and an author or committer identity that is not a GitHub noreply address;
2. sets the version in `Cargo.toml` and `Cargo.lock`;
3. moves the Unreleased notes into a `## X.Y.Z` section;
4. runs `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings` and `cargo test --locked` (`-SkipTests` skips the last; CI runs it again), and restores the edited files if a check fails;
5. commits `Release X.Y.Z` and creates the annotated tag `vX.Y.Z`;
6. pushes with explicit refs: `git push origin HEAD:refs/heads/main`, then `git push origin refs/tags/vX.Y.Z`.

## What CI does

[`ci.yml`](../.github/workflows/ci.yml) runs on every push to `main` and every pull request: `cargo fmt --check`, clippy with `-D warnings`, the tests and a check that the crate ships only the files in `include` (on `windows-latest`), and `cargo deny check licenses advisories sources` ([`deny.toml`](../deny.toml)).

[`release.yml`](../.github/workflows/release.yml), on the tag push:
- checks that the tagged commit is on `main` (`git merge-base --is-ancestor`) and resolves the tag to one commit that every later job builds;
- checks that the tag matches the `Cargo.toml` version;
- on `windows-latest`: runs the tests and `scripts/package-release.ps1`, which builds with local paths stripped, refuses a binary that still contains the checkout or profile path, and writes `orrery-<version>-windows-x64.zip` (`orrery.exe`, `LICENSE`, `THIRD_PARTY_NOTICES`, `README.md`, `register.ps1`, `unregister.ps1`);
- attaches signed build provenance (GitHub artifact attestations; `gh attestation verify <zip> --repo rennerdo30/orrery`);
- writes `SHA256SUMS.txt` and creates a **draft** release with the changelog section as notes. A rerun (Actions, release, Run workflow, with the tag) refreshes a draft and never touches a published release.

Orrery is Windows only (WebView2), so there is one x64 package. On other targets the crate stops with a `compile_error!` that says so. The runner label was checked on 2026-11-19 against GitHub's "GitHub-hosted runners" reference; recheck it before each release.

The owner reviews the draft and publishes it.

## crates.io

[`publish-crate.yml`](../.github/workflows/publish-crate.yml) is manual (Actions, publish-crate, Run workflow, with the tag). Run it after the GitHub release is published. It runs on `windows-latest`, since the crate only builds on Windows.

One-time setup by the owner (agents never create or handle secrets):
1. Create a crates.io API token (crates.io, Account Settings, API Tokens) with the `publish-new` and `publish-update` scopes; once `orrery-viewer` exists, replace it with a token limited to that crate.
2. The `crates-io` environment exists in the repository (Settings, Environments) with the owner as **required reviewer**, so each upload needs an approval.
3. Add the token as an **environment secret** named `CARGO_REGISTRY_TOKEN` in `crates-io` (not a repository secret).

The workflow checks out `refs/tags/<tag>`, refuses a tag that is not on `main`, a prerelease tag or a tag that does not match `Cargo.toml`, runs `cargo package --locked` (which builds the packaged crate to verify it) in a step **without** the token, and only then runs `cargo publish --locked --no-verify` with the token in that one step's environment. No compiled code (build scripts) ever runs next to the token.

**Switching to Trusted Publishing after the first upload.** crates.io can issue a short-lived token over OIDC so no long-lived secret is stored, but the crate must already exist. After the first upload: crates.io, `orrery-viewer`, Settings, Trusted Publishing, add repository `rennerdo30/orrery`, workflow `publish-crate.yml`, environment `crates-io`. Then give the job `permissions: id-token: write`, add a `rust-lang/crates-io-auth-action` step (pinned to a commit SHA) with `id: auth`, pass `${{ steps.auth.outputs.token }}` as `CARGO_REGISTRY_TOKEN` to the publish step, and delete the stored secret and the API token. Source: https://crates.io/docs/trusted-publishing.

`cargo package --list` shows what ships (`include` in `Cargo.toml`: `src`, `build.rs`, `assets`, `Cargo.toml`, `Cargo.lock`, `LICENSE`, `THIRD_PARTY_NOTICES`, `README.md`, `CHANGELOG.md`, `register.ps1`, `unregister.ps1`).

## Third-party notices

After any dependency change, regenerate `THIRD_PARTY_NOTICES` with `tools/gen-notices/gen-notices.ps1` and commit it; the release zip and the crate both ship it.

## What protects a download

- **The checksum protects integrity, not authenticity.** It comes from the same release as the zip; the build provenance attestation ties the zip to this repository's workflow.
- **The exe is not code-signed.** SmartScreen may warn on the first run of a downloaded copy; `cargo install --locked orrery-viewer` builds on your machine and has no such prompt. Signing is a separate owner decision.
