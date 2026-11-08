# Atmora rename status

Updated: 8 November 2026.

The application name is **Atmora**. The main branding change was saved in commit
`f0b4abe` (`name change Atmora`), build `2026-11-08.6`.

Completed application branding:

- Main browser title and visible heading.
- Manifest name and short name.
- Build tooltip, cloud comparison lab and exported comparison filename.
- Current documentation titles and project introduction.
- Geolocation diagnostic title (`location-test.html`), included in the
  follow-up working-tree changes.

The user selected application branding only; repository and folder migration
are outside the current scope. The verified local folder is
`/Users/williamcharash/Documents/GitHub/ipma-radar`, and `origin` is
`https://github.com/BCharash/ipma-radar.git`. Hosting settings and the published
URL have not been verified in this recovery session. No repository rename,
folder move, push or deployment was performed in this session.

For a repository migration, the intended new name is **Atmora**. First inspect
the hosting configuration and current published URL, then establish the new URL
and the outcome for existing links and installations. After those details are
resolved, rename the existing repository, update `origin`, verify publishing,
and move/reopen the local folder last. Preserve Git history and existing data.
The older [migration proposal](skyflow-rename-plan.md) provides background on
these steps; its SkyFlow name is superseded.

Keep IPMA provider attribution, radar endpoints, internal cache/preference keys
and historical records unchanged. The manifest start URL remains `./`.

Recovery validation: headless Chrome passed at widths of 320, 390 and 1280
pixels for the Atmora title, heading and build tooltip, heading fit and absence
of horizontal overflow. Manifest names, unchanged start URL, icon responses,
diagnostic title and cloud-lab title passed. Installed iPhone labels and the
hosted deployment have not been checked.

Build `2026-11-08.7` adds explicit `apple-mobile-web-app-title` and
`application-name` metadata set to Atmora after an iPhone still suggested
SkyFlow when adding to the Home Screen. The page title and both manifest names
were already Atmora. The iPhone's URL and served/cached version must be checked
before attributing the old suggestion to a specific cause. Physical iPhone
acceptance remains outstanding.

Live URL checked on 8 November 2026:
`https://bcharash.github.io/ipma-radar/`. The HTML, manifest and build script
returned HTTP 200. The published HTML title and both manifest names are Atmora;
the published build is `2026-11-08.6`, without the new Apple-specific title
metadata. This confirms that the reported SkyFlow suggestion does not match
the currently served title or manifest; the exact iPhone-side cause remains
unverified. Build `2026-11-08.7` remains local.
