# Build identification

Atmora uses `YYYY-MM-DD.N`: the UTC release preparation date and a daily sequence
starting at `1`, following iMuse's format. The first build was `2026-11-08.1`; `2026-11-08.2` moves the label to the map credits.

`src/js/build-info.js` is the single source of the identifier. Map initialization displays
it in the attribution area at the bottom, alongside provider credits. The number
identifies the loaded build script, not the date the user opened the page.

Advance the identifier before sharing changed application files for testing or
publishing them. Several unshared edits can belong to one candidate. Retrying
deployment with identical files keeps the same identifier. Documentation-only
and test-only changes do not require an increment. Do not reuse a released
identifier for different application contents.

This label does not verify cache consistency across scripts and stylesheets.
No automatic reload, cache clearing or deployment workflow is introduced.
When reporting a problem, include the displayed build, page URL and browser/device.
