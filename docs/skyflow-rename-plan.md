# Rename ipma-radar to SkyFlow

Prepared: 6 November 2026.
Status: planning only. Creating this document does not authorize or perform an
application rename, repository rename, folder move, push or deployment.

## Recommendation

Rename the existing project in stages. Keep its Git history and repository
settings. A new repository with copied files offers no particular protection
against deployment or installed-app URL changes, and introduces another setup
to maintain. A separate repository is appropriate only if an independently
published fork is wanted.

The lowest-risk checkpoint is to brand the application **SkyFlow** while leaving
its repository, folder and public URL unchanged. After validating that release,
rename the repository and optionally the local folder once publishing is understood.
There is no technical requirement that the app name and repository name match.

## Verified starting point

These facts were checked in the local checkout; hosted settings were not inspected.

| Item | Current value |
| --- | --- |
| Local folder | `/Users/williamcharash/Documents/GitHub/ipma-radar` |
| Git branch | `main` |
| Git remote | `https://github.com/BCharash/ipma-radar.git` |
| Main page | `index.html` |
| Browser title | `IPMA Radar` |
| Visible heading | `IPMA` |
| Manifest | `manifest.json` |
| Manifest name / short name | Both `IPMA Radar` |
| Manifest description | `IPMA precipitation radar for Portugal` |
| Manifest start URL | `./` |
| Manifest explicit `id` / `scope` | Neither currently specified |
| Satellite cache name | `ipma-satellite-images-v1` |
| Rain-filter preference key | `ipmaRadarMinimumRain` |
| Existing lab branding | Already uses SkyFlow |
| Publishing configuration in checkout | No `.github` workflows, `CNAME`, or Netlify/Vercel configuration found |
| Service worker registration | None found in the application scripts |

The design journal describes GitHub Pages as the intended hosting model. That
is not confirmation of the current live publishing configuration: Pages can be
configured entirely in GitHub settings without a workflow file in the checkout.

## Risks and how to limit them

| Change | Risk | Approach |
| --- | --- | --- |
| Page/manifest display names | Low; compact heading may wrap, installed labels may update differently by browser | Keep URLs and app identity unchanged; check desktop and iPhone |
| Internal cache/preference names | Unnecessary cold downloads or lost preferences | Preserve existing internal keys during rebranding |
| Repository name | Git URLs redirect, but a project website has separate URL behavior | Confirm hosting first; update remote and validate publishing |
| Public path or domain | Old links, installations and browser storage may no longer behave as before | Choose a URL strategy before changing the repository |
| Manifest identity | Existing and new installs could be treated as different applications | Record current installed identity; avoid changing `id` casually |
| Local folder name | IDE tasks, saved workspaces and tools may reference the old absolute path | Move it last, after closing/reopening the workspace |

GitHub redirects repository web/Git traffic after a rename, but explicitly
excludes **project-site URLs** from that promise. Do not rely on the old GitHub
Pages address redirecting to the new project path. Avoid reusing the old
repository name for a new repository: GitHub warns that doing so breaks the
repository redirect. [GitHub repository rename documentation](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)

## Phase 1 — Record publishing and recovery information

Read-only investigation before modifying branding or repository settings:

1. Open the existing repository's **Settings → Pages** and record the published
   URL, source branch/folder or Actions deployment, custom domain, and HTTPS state.
2. Check other hosting dashboards if the current site is published elsewhere.
   Record any repository link, project name, build/output directories, base path,
   environment variables and automatic-deployment triggers. Do not copy secrets
   into this document or a commit.
3. Record the current working deployment commit and the local `git rev-parse HEAD`.
   Check `git status --short` and preserve any work that is not part of renaming.
   Ensure the current working version is committed/backed up before proceeding.
4. Note where the old URL is used: bookmarks, shared links, installed PWAs,
   documentation, and any references in PraiasPortugal or other projects.
5. Record the installed app's start URL and, where the browser exposes it, its
   app identity. The current manifest has no explicit `id`, so `start_url` is the
   fallback identifier in supporting browsers.
6. Verify that `SkyFlow` is available as a repository name in the GitHub account.

**Checkpoint:** current URL, hosting mechanism, recovery commit and intended
new repository name are recorded. Stop the repository/public-URL portion if
these are still unknown; display-name branding can remain a separate change.

## Phase 2 — Prepare application branding at the existing URL

Use a small reviewable branding change, preferably on a branch such as
`chore/skyflow-branding`. Prepare and test it before any public deployment.

| File / area | Planned change |
| --- | --- |
| `index.html` | Browser title and visible application heading become `SkyFlow` |
| `manifest.json` | `name` and `short_name` become `SkyFlow`; update description |
| `README.md` | Main project heading and current introduction use SkyFlow |
| `docs/design-journal.md` | Current title uses SkyFlow; append the rename decision and validation |
| `location-test.html` | Diagnostic title may become `SkyFlow Location Test` |
| Icons | Inspect existing icons for old text; replace only if needed and agreed |
| Other current instructions | Update current product-name references where appropriate |

Suggested description: **Cloud imagery and rain radar, with IPMA radar for Portugal.**
Do not advertise worldwide weather coverage before the weather-source routing
and coverage have actually been implemented.

Preserve during this phase:

- `start_url: "./"`, manifest location, public paths and any current installed identity.
- Existing internal storage names: `ipma-satellite-images-v1`,
  `ipmaRadarMinimumRain`, and `X-IPMA-Radar-Bytes` cache metadata headers.
- IPMA provider attribution, radar URLs, original registration bounds and
  IPMA-specific messages about radar availability.
- GeoColour, map rendering, playback, Low/High quality, coverage staging and caches.
- Archived integration documents and historical journal entries. Historical
  `ipma-radar` paths should remain accurate records, not receive a blanket replacement.

An explicit stable manifest `id` can be considered after inspecting the existing
installation. If added to preserve identity, it must match the current effective
identifier; it must not simply be invented as `/SkyFlow/`. Relative `id` values
resolve against the origin, unlike assumptions based on the manifest directory.
Browser support varies. [Manifest identity reference](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id)

**Validation:** inspect the new title/header, including a narrow phone viewport;
validate manifest JSON; load icons and lab links; run `python3 tests/browser-check.py --quick`;
confirm Map/GeoColour, radar, playback, frame dimensions and preference retention.
Check an actual iPhone/Safari installation separately for its displayed name and
launch behavior. Do not assume an installed label updates immediately.

**Checkpoint:** a concrete branding diff and validation results are ready to review.
Deploy this branding at the current URL only when authorized. Confirm the hosted
release before proceeding to repository/URL changes.

## Phase 3 — Choose the published URL strategy

Select one based on the recorded hosting configuration:

| Strategy | Effect |
| --- | --- |
| Keep the repository/path for now | App is SkyFlow while the existing address remains intact; smallest migration |
| Existing custom domain or independently named hosting site | Repository may be renamed while the site address stays the same, subject to host configuration |
| Rename a default GitHub Pages project site | Plan for a new repository-based path and explicitly address old links/installations |
| Adopt a custom domain | Can separate the public address from future repository naming; adds domain/DNS work and is optional |

If default GitHub Pages is confirmed with no custom domain, the expected addresses
would be `https://bcharash.github.io/ipma-radar/` and
`https://bcharash.github.io/SkyFlow/`. These are **conditional examples**, not
verified current/future deployment URLs. Use the exact URL shown in Pages settings,
including the actual path casing. Account-level custom-domain settings can also
influence project-site addresses.
[GitHub Pages domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages)

For a path/domain move:

- Test relative scripts, styles, data, icons, manifest and lab links beneath the
  new prefix. Audit leading-slash application URLs; the lab's `/__lab/` routes
  intentionally belong to its local server and do not become a static Pages backend.
- Check installed launch URLs and manifest scope/identity. A stable identity can
  help in supporting browsers, but does not itself make an old launch URL work.
- Do not assume stored preferences or caches migrate. `localStorage` is origin-
  based; a same-origin path change may retain it, while an origin change does not
  automatically transfer it. Browser Cache Storage is also origin-based. Recheck
  behavior with the chosen URL rather than clearing data as a first step.
- Provide the new link and reinstall instructions where needed. If preserving the
  old project URL is essential, arrange an explicit supported redirect/hosting
  solution or defer the repository rename. Do not create an old-name repository
  casually, because it changes GitHub's repository redirect behavior.

**Checkpoint:** the intended published address, old-link behavior, installed-app
handling and recovery route are agreed before the repository is renamed.

## Phase 4 — Rename the existing GitHub repository

After the preceding checkpoints and authorization:

1. In GitHub **Settings → General**, rename `ipma-radar` to `SkyFlow`.
2. Update the local remote; this changes the Git connection, not the local folder:

   ```sh
   git remote set-url origin https://github.com/BCharash/SkyFlow.git
   git remote -v
   git fetch origin
   ```

3. Verify history, branches, issues and repository settings are still present.
4. Apply any reviewed hosting/repository-link changes and trigger the normal
   deployment when authorized. Watch the actual deployment result.
5. Test the real published URL, assets, manifest, geolocation, GeoColour/radar,
   playback, zoom coverage, Low/High indicators and lab access. Check the expected
   behavior at the old URL separately.
6. Update current clone/publishing instructions to the confirmed new remote/URL.

No force push, history rewrite, source copy or new repository is required.
GitHub's repository redirect is a convenience, not a substitute for updating the
remote and verifying the published site.

## Phase 5 — Optionally rename the local folder

This can wait indefinitely. The app and Git remote work with the original local
folder name. If a matching local folder is wanted:

1. Close tasks/Live Server and close the VS Code workspace.
2. Confirm the destination does not already exist.
3. From `/Users/williamcharash/Documents/GitHub`, rename the existing folder
   `ipma-radar` to `SkyFlow`, using Finder or a reviewed `mv` operation. Do not copy
   files into a second repository or overwrite an existing directory.
4. Reopen `/Users/williamcharash/Documents/GitHub/SkyFlow` in VS Code/Codex.
5. Check `git status`, `git remote -v`, Live Server, lab-server commands, and any
   editor/workspace settings or external scripts that use the old absolute path.

Moving the active workspace is deliberately last: it changes the path used by
this coding session and may require a new workspace/session or filesystem approval.

## Rollback

- **Branding only:** revert the branding commit and redeploy through the same
  authorized publishing process. Existing app data and internal cache keys remain.
- **Repository rename:** if the old name is still available, rename back, restore
  the recorded remote, and review Pages/host settings. Recheck the actual public
  URL; renaming back is not a guarantee of immediate hosting restoration.
- **Local folder move:** close the workspace, move it back without overwriting
  another folder, then reopen the old path.
- **Installed app / public URL:** restore the documented working endpoint where
  feasible and verify an existing installation. A reinstall may still be needed
  if the launch address or identity changed.

Use the recorded known-good commit for recovery. Do not reset/delete browser
storage or remove the old installed app before its recovery behavior is understood.

## Completion criteria

- The UI, manifest and current project introduction consistently say **SkyFlow**.
- Provider attribution still identifies IPMA/EUMETSAT and the map sources correctly.
- Git history is retained and the remote points to the intended repository.
- The deployed URL is confirmed, with an explicit outcome for old links.
- Existing/new PWA launches have been checked on the relevant devices.
- Radar, GeoColour, Map view, playback, caching, quality readouts and zoom behavior
  retain their tested functionality.
- Current documentation records the actual final names/URLs and the rollback
  checkpoint; historical documentation remains historically accurate.

Implementation has not begun. This document is the proposed execution order.
