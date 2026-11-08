# SkyFlow — Design journal

This is the maintained technical design record for standalone satellite imagery and IPMA radar
and their eventual integration into Praias de Portugal. It is based on the existing
[integration handoff v3](archive/IPMA_Radar_Integration_Summary_v3.md), which
extends [v2](archive/IPMA_Radar_Integration_Summary_v2.md). Its technical decisions,
investigation findings, rejected approaches, and integration requirements are
retained below; subsequent changes are recorded in dated entries afterward.

The [README](../README.md) provides the current file map and launch instructions.
The archived handoffs retain their original bodies for historical comparison.

The inherited investigation predates this journal; its individual experiments
are not assigned new dates. Statements about IPMA's website, CORS behavior, and
prior visual/device testing record the handoff's findings, rather than new
external checks performed during the November refactor. The dated entries
separate recent verification from that inherited evidence.

## Design foundation — inherited investigation and decisions

The central decision is to use IPMA's actual timestamped radar PNGs with the
exact geographic bounds found in IPMA's own Leaflet implementation. The
following sections preserve the reasoning and implementation constraints that
established that baseline. File paths have been updated for the current layout.

### Standalone application baseline

The standalone app currently provides:

- Leaflet + OpenStreetMap base map.
- IPMA mainland Portugal precipitation radar.
- Automatic current-location positioning.
- Fallback location near Praia de Santa Rita.
- 1, 2, or 3 hours of radar history.
- 5, 10, 15, or 20 minute frame intervals.
- Previous / Play-Pause / Next controls.
- Smooth playback using preloaded/decoded frames and Leaflet ImageOverlays.
- Automatic discovery of the newest radar image actually published by IPMA.
- Manual Refresh button.
- Explicit “Radar is current” feedback when Refresh finds no newer image.
- Frame counter showing frame number and Lisbon local time.
- Loop playback toggle.
- Optional radar range overlay (three 120 km circles).
- PWA manifest and iPhone home-screen icon support.
- Favicon.
- Vertical precipitation-intensity legend.
- Complete IPMA precipitation-rate scale in the legend, with a separate 0.1/0.5 mm/h minimum-display control.
- Public GitHub/GitHub Pages deployment as the intended hosting model.

The standalone version should be regarded as the **known-good reference implementation** during integration.

---

### The most important architectural decision: obtain the actual IPMA PNGs directly

#### Do NOT depend on `imgs-radar.json`

During development, the IPMA JSON endpoint used to enumerate radar images proved unsuitable because the endpoint is CORS-blocked when requested from the app's local/GitHub Pages origin.

The successful solution is to request the radar PNGs directly.

Base path:

    https://www.ipma.pt/resources.www/transf/radar/por/

Filename pattern:

    pcr-YYYY-MM-DDTHHMM.png

For example:

    pcr-2026-09-05T1415.png

The timestamp encoded in the filename is UTC.

This direct-PNG approach is preferable because:

1. It avoids the CORS problem associated with the JSON index.
2. The URLs are deterministic and timestamp-based.
3. The application can test whether a particular image actually exists.
4. The application does not have to trust a separate index to tell it which frame is current.
5. The application can sometimes obtain a newly published image before IPMA's public webpage has updated its displayed state.

No API key is required merely to retrieve these public radar PNG resources.

**Do not replace this with a third-party radar source or a generic weather-radar tile service.** The goal is to display IPMA's actual product.

---

### Finding the newest actual image

Radar imagery is produced on a five-minute grid, but the image for the nominal current timestamp may not yet have been published.

The app therefore does not simply construct the current filename and assume it exists.

The current logic:

1. Determines the current five-minute UTC candidate.
2. Tests that image.
3. If unavailable, checks previous five-minute timestamps.
4. Searches backward up to 30 minutes.
5. Uses the newest image that actually exists.

This is important.

**Do not introduce an artificial delay** simply because IPMA's public webpage may display an older frame. The desired behavior is:

> show the newest radar image IPMA has actually made available.

---

### Authoritative radar geographic registration

This was the most important discovery in the entire investigation.

The correct geographic bounds were obtained directly from IPMA's own JavaScript:

    https://www.ipma.pt/pt/otempo/obs.remote/mapbuilder-pt.js

IPMA's `buildLayers()` code defines the Portugal radar bounds as:

    var boundspor = new L.LatLngBounds(
        new L.latLng(34.011513, -12.454795),
        new L.latLng(43.792862, -4.345465)
    );

In the standalone app these are represented as:

    const RADAR_BOUNDS = [
      [34.011513, -12.454795],
      [43.792862, -4.345465]
    ];

That means:

    southwest:
        latitude  34.011513
        longitude -12.454795

    northeast:
        latitude  43.792862
        longitude -4.345465

#### These values are authoritative, not estimated.

They were extracted from the code IPMA itself uses to construct its radar `ImageOverlay`.

IPMA then effectively does:

    new L.ImageOverlay(
        IPMA radar PNG URL,
        boundspor,
        { opacity: 0.8 }
    );

This is much stronger evidence than trying to infer the image registration from:

- the PNG dimensions,
- screen coordinates,
- CSS transforms,
- Leaflet pixel positions,
- visual alignment,
- or an assumed Portugal bounding box.

---

### Why the earlier registration was wrong

An earlier implementation used approximately:

    [31.98944, -10.96436]
    [42.03297, -2.85645]

Those bounds were wrong.

They caused the radar pixels to be geographically stretched/positioned incorrectly, including an apparent extension too far into Spain.

This was not merely a map viewport problem.

There are two completely different concepts:

##### Map extent / viewport

Controls what portion of the geographic map the user sees.

##### ImageOverlay bounds

Determine where the radar PNG's pixels are geographically located.

Changing the map center or zoom cannot correct an incorrectly registered radar overlay.

**For integration, preserve `RADAR_BOUNDS` exactly.**

---

### Independent confirmation from IPMA's map settings

IPMA's own map initialization independently reinforces the same geographic footprint.

Its map configuration uses approximately:

    center: [39.67134, -8.40013]

and:

    maxBounds:
        southwest [34.01161, -12.45479]
        northeast [43.79278, -4.34547]

with:

    zoom: 7.00
    zoomDelta: 0.25
    zoomSnap: 0.25

The tiny differences between the maxBounds and the ImageOverlay bounds are normal implementation details. The important point is that IPMA's own map and radar overlay are built around the same geographic footprint.

This provides an independent validation of the `RADAR_BOUNDS` discovery.

---

### Radar image dimensions and what they do — and do not — tell us

IPMA radar PNGs have been observed at:

    1500 x 2331 pixels

The image may be rendered at a very different size by Leaflet depending on zoom and viewport.

For example, an IPMA page inspection showed an image rendered around:

    738 x 1148 pixels

and a Leaflet pixel position such as:

    x: 26
    y: -128

Those rendered values are **not geographic registration data**.

They are consequences of Leaflet's current viewport and transformation.

Do not use them to calculate or alter radar bounds.

---

### Frame construction and rolling history

The app constructs frames from timestamped filenames rather than treating frame numbers as permanent identifiers.

Default:

    history = 3 hours
    interval = 5 minutes
    frames = 37

That is:

    36 intervals + both endpoints = 37 frames

For example:

    Image 1  = 11:20
    ...
    Image 37 = 14:20

After a new 14:25 image becomes available, Refresh rebuilds the sequence:

    Image 1  = 11:25
    ...
    Image 37 = 14:25

Thus the oldest frame naturally falls out of the rolling window.

**Image 37 does not identify a permanent image.**

The timestamp is the actual identity of a radar frame.

Browser HTTP caching is separate from the application's frame list and should not be confused with it.

---

### Current playback architecture

The current implementation evolved beyond an earlier approach that tried to reuse a single overlay by changing its URL.

The current known-good implementation:

1. Builds the desired frame list.
2. Preloads the requested images.
3. Decodes them before animation.
4. Removes frames that IPMA did not actually supply.
5. Stores the resulting frames in `radarFrames`.
6. Creates the complete set of Leaflet `ImageOverlay` objects.
7. Animates by changing overlay visibility.

This gives smooth playback because the animation is not waiting for network requests between frames.

The current playback delay is approximately 180 ms per frame.

##### Important correction to the old handoff

The earlier investigation document described an implementation using one overlay whose URL was changed with `radarLayer.setUrl(frame.url)`. That is **not the current implementation**.

For future work, treat the current preloaded multi-overlay implementation as the baseline because it is the version that was actually tested and judged to give good smooth playback.

---

### Refresh architecture

The Refresh button calls the existing:

    rebuildRadar()

There is no separate refresh/loading mechanism.

`rebuildRadar()`:

- stops playback,
- starts a new load generation,
- rebuilds the requested timestamp sequence,
- finds actually available IPMA images,
- preloads and decodes them,
- removes unavailable frames,
- replaces `radarFrames`,
- starts at the newest frame,
- creates the overlays,
- updates the frame counter.

If the newest timestamp is unchanged, the UI briefly displays:

    Radar is current

This gives useful feedback on iPhone/Safari where the button's pressed state alone is not sufficient feedback.

---

### Loading/performance architecture

An important lesson from the earlier investigation is that radar history loading and playback are different problems.

The current implementation prioritizes **reliable complete playback** by preloading and decoding the requested frame set before constructing the animation.

This differs from an earlier experimental strategy that displayed the newest frame first and loaded older frames in background batches.

That earlier strategy was useful during investigation, but the current preloaded implementation is the known-good baseline because playback is smooth and predictable.

If performance optimization is revisited later, preserve the following principle:

> Optimize loading without sacrificing the smooth, already-loaded playback behavior.

Do not revert to downloading frames one at a time during animation.

---

### Time handling

IPMA filenames contain UTC timestamps.

The user-facing frame counter converts those timestamps to:

    Europe/Lisbon

using JavaScript `Intl.DateTimeFormat`.

This automatically handles Portugal's daylight-saving changes:

- winter: UTC
- summer: UTC+1

The underlying radar timestamp remains UTC; only its presentation is localized.

Do not hard-code a permanent one-hour offset.

---

### Intensity legend

The app now includes a compact vertical precipitation-intensity legend in the lower-left of the map.

The location is intentional:

- the left side of the Portugal radar display is largely Atlantic Ocean;
- the legend can therefore occupy the lower-left without obscuring important mainland information;
- Leaflet attribution is on the right;
- the frame/time indicator occupies a different area.

The actual IPMA precipitation-intensity thresholds represented are:

    >300
    200
    100
    70
    50
    40
    30
    20
    10
    8
    6
    4
    3
    2
    1
    0.5
    0.1 mm/h

The legend is deliberately numerical as well as chromatic. This makes the radar easier to interpret for people whose color perception does not reliably distinguish the full radar palette.

The legend background is intentionally translucent rather than opaque so that it remains unobtrusive over the map.

### Minimum-rain display filter

The standalone radar includes a deliberately limited **Minimum** selector in the legend.

The current choices are:

- **0.1 mm/h** — show the complete IPMA radar image.
- **0.5 mm/h** — suppress the weakest radar returns below the lowest useful displayed level.

The selector previously included 1 and 2 mm/h experimental filters. Those options were removed because the rendered IPMA PNG does not provide sufficiently reliable browser-side pixel classification for those thresholds.

##### Important implementation note

The 0.5 mm/h setting has been retained because visual testing showed that it successfully removes the weakest blue returns while preserving the stronger radar returns.

This should be regarded as a **visual display filter**, not as a numerical reconstruction of the underlying IPMA rainfall field.

The filter should:

- preserve the original IPMA radar colors;
- make qualifying low-intensity pixels transparent rather than recoloring them;
- preserve the normal radar overlay opacity;
- persist the user's 0.1/0.5 selection using `localStorage`;
- default to 0.1 mm/h.

The numerical legend itself continues to show the complete IPMA scale. The selector is **not** intended to duplicate that scale; it is simply a practical visual cleanup control.

---

### Radar range overlay

The standalone radar also includes an optional **Radar range** map control.

When enabled, it displays three **120 km radius circles**, corresponding to the approximate radar coverage range around the three mainland IPMA radar sites:

```javascript
const RADAR_SITES = [
  { name:"Arouca",  lat:40.84502, lon:-8.27972 },
  { name:"Coruche", lat:39.07137, lon:-8.40011 },
  { name:"Loulé",   lat:37.30408, lon:-7.95308 }
];

const RADAR_RANGE_KM = 120;
```

The circles:

- have no labels;
- have no fill;
- use a subtle outline;
- include a small center marker for each radar site;
- are displayed above the radar image;
- do not interfere with map interaction;
- are controlled by a small Leaflet map control near the location control;
- are **off by default**;
- are not persisted between sessions.

The range overlay is informational. It does not clip or otherwise alter the radar image.

The 120 km distance is particularly relevant because IPMA notes that at distances greater than approximately 120 km from a radar, the observed radar quantity can become less representative of conditions near the surface.

##### Integration requirement

The range circles must be implemented as a separate Leaflet layer. They must **not** be incorporated into `RADAR_BOUNDS` or used to modify the radar image registration.

The authoritative radar registration remains:

```javascript
const RADAR_BOUNDS = [
  [34.011513, -12.454795],
  [43.792862, -4.345465]
];
```

---

### Map viewport versus radar registration

The application should maintain the distinction between:

1. the **radar's full geographic registration**, and
2. the **portion of the map initially shown to the user**.

The radar overlay should retain IPMA's full authoritative bounds.

The map can nevertheless be focused on Portugal.

The current standalone app uses a fallback location near Praia de Santa Rita:

    lat: 39.0867
    lon: -9.3777
    zoom: 7

When geolocation succeeds, it centers on the user's position and uses at least zoom 8.

When integrated into Praias de Portugal, the beach app can use its own preferred starting location and recentering logic without changing `RADAR_BOUNDS`.

---

### Original investigation lesson: make sure debugging is happening in the correct page

A major source of confusion during development was accidentally running browser-console commands against the real IPMA webpage rather than the local application.

The IPMA page looks similar to the app, and it uses many of the same concepts.

Console output from the real IPMA page included:

- arrays of radar URLs,
- elements such as `imgRadar`,
- internal radar variables,
- Leaflet overlay information.

Those results were initially mistaken for evidence about the local application.

The key lesson is:

> When debugging the integrated application, always establish that the browser console and DOM inspection are operating on the actual Praias de Portugal application, not the IPMA webpage.

This is worth retaining in the integration documentation because it caused substantial wasted investigation time.

---

### Repository and hosting

The standalone project repository is:

    https://github.com/BCharash/ipma-radar.git

Repository name:

    ipma-radar

The project is intended for public GitHub Pages hosting.

Do not confuse this with the earlier conversationally mentioned “IPMA Test” repository; that name was erroneous.

The standalone project should remain available as a reference while the radar is integrated into Praias de Portugal.

---

### PWA / browser assets

The standalone app includes:

    index.html
    manifest.json
    assets/images/icon-192.png
    assets/images/icon-512.png
    assets/images/apple-touch-icon.png
    assets/images/favicon.png

`index.html` includes the manifest, Apple touch icon, and favicon references.

This is relevant when moving the radar into the larger application: the radar itself does not necessarily need to retain these as separate assets if Praias de Portugal already has its own PWA identity. The important point is to avoid accidentally removing the main application's existing PWA configuration while integrating the radar.

---

### Things deliberately excluded

Status update, 6 November 2026: the original satellite exclusion below is
superseded by the user's explicit request for cloud imagery with an optional
simultaneous radar overlay. See the dated satellite entry later in this journal.

Satellite imagery was investigated earlier but was explicitly excluded.

Do not reintroduce satellite view unless specifically requested.

The radar component should remain focused on the IPMA precipitation product.

---

### What should be carried into Praias de Portugal

Treat the following as the radar core:

##### Acquisition

- Direct IPMA PNG URLs.
- Timestamp-based filename construction.
- Five-minute timestamp grid.
- Latest-actually-available search.
- 30-minute backward search window.

##### Geographic registration

    const RADAR_BOUNDS = [
      [34.011513, -12.454795],
      [43.792862, -4.345465]
    ];

##### Frame management

- History selection.
- Interval selection.
- Timestamp-based frame identity.
- Rolling history.

##### Loading and playback

- Preloading.
- Image decoding.
- Filtering unavailable frames.
- Leaflet ImageOverlays.
- Smooth playback using already-loaded frames.

##### User controls

- Previous.
- Play/Pause.
- Next.
- Refresh.
- Minimum radar display threshold (0.1 / 0.5 mm/h).
- Radar range toggle (three 120 km radar circles).

##### User feedback

- Loading status.
- “Radar is current”.
- Frame number.
- Lisbon-local timestamp.

##### Accessibility / interpretation

- Numerical IPMA precipitation-intensity legend.

---

### Things NOT to regress

Do not:

- replace direct IPMA PNG acquisition with `imgs-radar.json` unless CORS has independently changed and been deliberately tested;
- replace the IPMA bounds with guessed Portugal bounds;
- infer registration from CSS transforms, screen coordinates, rendered image dimensions, or Leaflet pixel positions;
- assume the newest nominal five-minute timestamp is already published;
- introduce an artificial delay before using a newly published image;
- download images one at a time during playback;
- treat frame numbers as permanent image identifiers;
- replace the IPMA intensity scale with an invented simplified scale;
- hard-code Portugal's summer UTC offset;
- solve a viewport problem by changing the ImageOverlay bounds;
- reintroduce satellite imagery without an explicit request;
- accidentally debug the IPMA website instead of the integrated application;
- restore the 1 or 2 mm/h experimental threshold filters;
- describe the 0.5 mm/h display filter as exact numerical pixel classification;
- remove the Radar range toggle;
- change the radar range from 120 km without a deliberate product decision;
- add labels to the three range circles;
- use the range circles to alter `RADAR_BOUNDS` or clip the radar image.

---

### Integration strategy

The safest approach is:

1. Preserve the standalone radar as a known-good reference.
2. Use the separated radar scripts in `src/js/`, styles in `src/css/radar.css`, and markup in `index.html` as the integration source.
3. Integrate those pieces into the Praias de Portugal map architecture.
4. Preserve `RADAR_BOUNDS` unchanged.
5. Preserve direct IPMA PNG acquisition unchanged.
6. Preserve timestamp handling and latest-frame discovery.
7. Preserve preloading/playback behavior initially.
8. Adapt only the surrounding UI, map lifecycle, and beach-specific positioning.
9. Test the integrated version against the standalone version before adding further optimization.

Do not simultaneously change acquisition, geographic registration, playback, and UI. If something fails, the changes will otherwise be difficult to diagnose.

---

### Testing checklist for the integrated version

Test on desktop and on the real iPhone/Safari environment:

- initial radar appearance;
- newest available frame;
- geographic registration over Portugal;
- zooming;
- panning;
- current-location positioning;
- history selection;
- interval selection;
- Previous;
- Next;
- Play/Pause;
- loop on/off and end-of-sequence behavior;
- minimum-rain filter selection and persistence;
- radar range toggle and separate-layer behavior;
- replay after loading;
- Refresh when a newer image exists;
- Refresh when the radar is already current;
- frame numbering;
- Lisbon local time;
- legend visibility and readability;
- behavior on cellular data;
- behavior after reopening;
- browser memory behavior;
- GitHub Pages/public hosting behavior.

The integrated app should be compared against the standalone known-good radar whenever a discrepancy appears.

---

### Recommended future refinement

The earlier investigation considered reducing the history to approximately four hours at 10-minute intervals, giving roughly 25 frames.

The standalone app was subsequently stabilized with a 3-hour default and selectable 5/10/15/20-minute intervals.

Therefore:

**Do not change the current history configuration merely because the old handoff mentioned four hours.**

If a longer history or different default is desired in Praias de Portugal, make that a deliberate product decision after the radar has been integrated and tested.

---

### Central insight to preserve

The most important conclusion of the entire investigation is:

> **IPMA itself uses the timestamped public radar PNGs as Leaflet ImageOverlays and registers the Portugal radar with the exact bounds:**

    [34.011513, -12.454795]
    [43.792862, -4.345465]

The bounds were discovered by examining IPMA's own `mapbuilder-pt.js`.

The earlier Spain-registration problem was not a mysterious transformation issue. It was caused by registering the radar PNG against incorrect geographic bounds.

The current implementation is therefore based on IPMA's own acquisition and registration logic rather than an approximation.

---

### Baseline technical summary

The standalone radar is now a good, stable reference implementation.

Its strongest technical properties are:

- **actual IPMA radar PNGs**, not a substitute data source;
- **direct timestamped URLs**, avoiding the CORS-blocked JSON index;
- **newest-actually-published image discovery**;
- **IPMA's exact geographic registration bounds**;
- **preloaded frames for smooth animation**;
- **rolling timestamp-based history**;
- **manual refresh**;
- **Lisbon-local timestamps**;
- **numerical precipitation-intensity legend**;
- **Portugal-focused viewport without compromising radar registration**.

When integrating into Praias de Portugal, preserve these decisions first. UI integration and further optimization should come afterward.

The standalone application should remain the baseline against which the integrated radar is checked.

---

## 6 November 2026 — Extract CSS and JavaScript

The radar initially kept its markup, CSS, and application JavaScript together
in the root `index.html`. Extracted styles into `src/css/radar.css` and behavior
into `src/js/app.js`, matching PraiasPortugal's `src/css` and `src/js` layout.
The extraction preserved the embedded contents byte for byte and retained
Leaflet's load order. `location-test.html` remained an independent diagnostic.

Validation: source reconstruction and asset-path checks passed. The user
subsequently confirmed that the extracted application worked in their browser.

## 6 November 2026 — Separate JavaScript responsibilities

Split the application into ordinary scripts for IPMA frame/image services,
Leaflet rendering, location, playback, display controls, and application
coordination. This follows PraiasPortugal's existing script-loading approach
without introducing a framework or build step. `app.js` loads last and starts
the application after the feature scripts are available.

All 31 original function bodies and executable source lines were retained.
Shared page scope remains a deliberate intermediate state; file separation
alone does not provide a mountable radar component. The controller owns the
timeline and load generation, while feature scripts own their respective state.

Validation: the original and split versions passed the same JavaScriptCore
checks with simulated browser and Leaflet APIs. These covered startup, loading,
caching, playback, looping, refresh, history/interval changes, thresholds, range
controls, superseded loads, and location/radar failures. Actual browser and
iPhone rendering after this split still need confirmation.

## 6 November 2026 — Organize root assets and documentation

Moved runtime icons and the favicon to `assets/images/`. Moved original artwork
and the alternate touch icon to `assets/images/source/`, preserving the files
and their names. Updated the page and manifest references to the runtime icons.

Kept `index.html`, `location-test.html`, and `manifest.json` at the root to retain
the existing page URLs and manifest start URL. Kept the README at the root as
the entry point to the project documentation.

Preserved both earlier integration summaries in `docs/archive/` with visible
historical-status notices. The v3 integration handoff supplies the technical
foundation of this journal, including the earlier investigation, rejected
approaches, operating constraints, and integration checklist. The README remains
the current file guide. No image assets were deleted.

Validation: moved image contents were checked for exact preservation. Static
checks verified local HTML assets, manifest icons, documentation links, and
unchanged application JavaScript/CSS. Browser and installed-PWA icon checks
remain to be performed after the path changes.

## 6 November 2026 — Add satellite backgrounds without an API key

This initial static-background implementation is superseded by the opacity and
animation correction recorded in the next dated entry below.

The user's goal is to see meaningful rain systems approaching their location.
They do not want rain-gauge measurements or an API key. The previously failed
1/2 mm/h classification experiments remain closed; the existing 0.1/0.5 mm/h
visual filter is preserved. Nowcasting is a requested future investigation,
separate from this satellite addition.

Added independent background selection (Map, Visible, Infrared, Hybrid) and a
Rain radar toggle. Map with radar remains the default. The satellite pane sits
above the street tiles and below IPMA radar; location markers and range circles
retain their existing layering. Switching radar off also hides its legend/time
counter, stops playback, and disables its history/playback controls. Radar can
be re-enabled without reloading its history.

Data comes directly from the public
[EUMETView WMS](https://view.eumetsat.int/geoserver/wms?service=WMS&request=GetCapabilities),
without an account, API key, or proxy. Verified catalogue products:

| View | Provider layer |
| --- | --- |
| Visible (daylight) | `mtg_fd:vis06_hrfi` |
| Infrared | `msg_fes:ir108` |
| Hybrid (Geo Colour) | `mtg_fd:rgb_geocolour` |

Use the catalogue's published default observation time explicitly in WMS image
requests. Display that time separately from the radar frame time, with an older
image indication after 90 minutes. Hybrid is the provider's Geo Colour product;
the app does not synthesize a day/night image. EUMETSAT attribution is displayed
on the map when satellite is active.

This first addition uses a fixed latest satellite image while radar history
plays, clearly stated in the satellite status. It does not synchronize satellite
history to radar frames. Refresh requests updated satellite metadata alongside
the existing radar rebuild. Product switches cancel obsolete metadata requests;
generation checks reject late results. Metadata and initial image-loading
timeouts report satellite failure independently while retaining map and radar.

Validation: public catalogue and explicit-time GetMap requests for all three
products succeeded without credentials and returned PNG images. Responses
included `Access-Control-Allow-Origin: *`. Existing simulated radar regression
checks passed with the new module loaded. Live headless Chrome loaded all three
products as real WMS tiles alongside 37 IPMA radar frames, without JavaScript
errors. A 390-by-844 mobile viewport showed no horizontal overflow; the playback
row was adjusted to fit at typical phone widths and the screenshot was inspected.
Browser checks also passed for hiding radar across refresh, restoring radar and
the map view, offline metadata failure, tile failure, and late responses after
switching back to Map. These mobile viewport checks do not replace a real
iPhone/Safari acceptance check.

## 6 November 2026 — Correct satellite opacity, animation, and provider review

The initial satellite addition was incomplete for the requested use: it offered
an opaque, static latest-image background. This entry supersedes that behavior.

Added separate Satellite and Radar opacity controls, defaulting to 60% and 80%.
The map is visible beneath the imagery. Shared Play/Pause, Previous, Next, and
Loop controls now animate satellite alone or satellite with radar. History is
preloaded in batches of at most three, and failed images are skipped. Satellite
uses its provider's native 10/15-minute cadence; the interval selector controls
radar only. The satellite time is displayed separately from the radar time.

Combined playback selects a loaded satellite observation at or before the radar
frame, never a future satellite frame. Internal gaps longer than two native
intervals show no matching satellite image. Beyond the latest satellite time,
the latest observation can remain visible with its lag stated. This is observed
history, not nowcasting.

### IPMA satellite investigation

IPMA should have been checked before the original provider choice. Inspected
these public resources on 6 November 2026:

- [Satellite viewer](https://www.ipma.pt/pt/otempo/obs.satelite/): visible,
  infrared, and combined choices are available. The inspected page listed hourly
  JPEGs under date-specific, non-deterministic path segments. Its HTTP response
  did not include an Access-Control-Allow-Origin header, preventing a normal
  cross-origin browser fetch of that index. Displaying a known image URL is a
  different operation from discovering the image index.
- [Combined viewer script](https://www.ipma.pt/pt/otempo/teste/map-builder-dea2.js):
  satellite overlay construction exists inside commented-out code, with a
  satellite rectangle distinct from the radar rectangle. The old
  `combined-msg-108/msg-108-YYYY-MM-DDTHHMM.png` pattern returned HTTP 404 for
  four candidates on this date: 08:00, 08:15, 08:30, and 08:45 UTC.

This does not establish that all IPMA satellite services are unavailable.
Retained the verified public EUMETView WMS for this implementation: it supplies
explicit projection/bounds, observation times, and 10/15-minute histories
without an API key or proxy. No unverified IPMA JPEG was placed into guessed
map bounds.

### Registration and validation

Satellite animation images are now WMS GetMap images for a padded viewport in
EPSG:3857. Their requested BBOX and Leaflet overlay use exactly the same
projected geographic corners. The longer image side is capped at 1024 pixels
to limit history memory. Panning beyond coverage or changing zoom stops playback
and reloads the scene; the old scene remains geographically registered during
map transformation. IPMA radar bounds are unchanged.

Live Chrome checks loaded history for all three products and passed satellite
and radar opacity, satellite-only/combined animation, timestamp matching,
offline/image failures, and cancellation of late results. Some real satellite
image requests failed and were skipped. Projection checks at scene corners and
center, including after pan and zoom, measured a maximum error of about 0.51 CSS
pixels. This checks application placement, not instrument or ground accuracy.
See [registration and verification](registration.md) for the contract and checks.
Real iPhone/Safari acceptance remains outstanding.

Repeatable live checks are saved in `tests/browser-check.py`. The final quick
run passed history loading, opacity, satellite-only and combined animation,
timestamp ordering/lag, registration after pan/zoom, and failure/cancellation
recovery with no JavaScript errors. The longer run also exercised visible and
infrared products. A mobile screenshot was visually inspected. Existing
simulated radar checks passed after the shared playback changes.

### Audit of the initial assessment

The initial assessment used an older radar file. The newer file supplied before
the extraction already resolved several of those findings; the extraction did
not implement those fixes.

| Item | Current status and provenance |
| --- | --- |
| Unavailable newest radar frame | Already searches backward up to 30 minutes; preserved from the newer baseline. |
| Missing radar history frames | Already filters failed loads before playback; preserved from the newer baseline. |
| Refresh timeline | Manual Refresh already rebuilt the rolling 1–3-hour window; automatic periodic refresh is not implemented. The earlier six-hour description was obsolete. |
| Status conflicts | Satellite has its own status. Radar loading and explicit location requests still share status; full ownership/priority handling is pending. |
| Duplicate geolocation handlers | The newer baseline already had one direct geolocation path; preserved. |
| Scoped CSS | Pending. Page-wide body/select/layout rules remain. |
| Private state | Pending. Scripts still share page scope. The current radar no longer has the older hard-coded beaches catalogue, but other generic names remain. |
| Host-selected beach and lifecycle | Pending. No PraiasPortugal beach adapter, mount/resize/destroy contract, or host lifecycle integration is implemented. |

## 6 November 2026 — Reuse satellite images and keep geographic context visible

The user reported long satellite loads, apparent reversions to the street map,
and repeated downloads. The prior implementation cleared its scene before a
replacement was ready, used unrounded viewport BBOX values (new URLs after small
moves), retained no application image cache, and hid satellite across long
missing slots. This entry supersedes those loading/gap behaviors.

Added `satelliteCache.js` with a compressed-image memory cache (16 MiB budget)
and best-effort persistent Cache Storage (48 MiB / 96-entry limits). Keys include
product, exact time, projection, BBOX, and dimensions. Fresh image elements are
created from cached blob URLs so the same DOM element is not moved between old
and replacement overlays. Storage denial/quota failure falls back to memory.
Known failed URLs are deferred for 45 seconds; canceled requests are not marked
failed. These caches do not constitute a complete offline app package.

Scenes now use padded, grid-aligned projected bounds and are reused within
coverage and a one-level zoom difference. The same bounds are used for WMS and
Leaflet, preserving registration. Eight recent geometry definitions are retained
for returning to an earlier scene. Smaller viewports request a maximum 768-pixel
image side (1024 on larger viewports). Three loading workers queue recent frames
first and continue individually, avoiding a slow request blocking an entire
batch. Cold loads still depend on remote service latency and publication.

Previous imagery remains until replacement images can actually be shown. Failed
updates retain the previous image and report the failure separately. Choosing
Map explicitly still removes satellite. Panning outside the old coverage can
expose map areas until new coverage arrives; retained images are never stretched
to a new geographic rectangle. Product labels follow the displayed frames.

Radar/satellite sampling remains independent: selectable 5/10/15/20-minute radar
steps, native 10-minute visible/Geo Colour and 15-minute infrared observations.
Combined playback holds the latest earlier satellite observation across missing
slots and labels its real time/lag. It never substitutes a future satellite
observation. Satellite-only playback remains at native cadence.

Bundled about 89 KB of Natural Earth coastline and country land-boundary vectors
in `data/map-features.geojson`, clipped to longitude -40..15, latitude 25..55.
`mapFeatures.js` draws a light halo and dark outlines in a pane above both radar
and satellite, so they remain visible at 100% satellite opacity. This is local
regional context without an API key or a new runtime map-provider dependency.
Source revision, public-domain terms, and clipping method are in
[map data](../data/README.md).

Validation: live Chrome loaded seven hybrid observations and retained projection
alignment (about 0.51 CSS pixels after pan/zoom). Reloading the same prepared
scene issued zero GetMap requests, with seven memory-cache hits. Removing one
memory entry and loading it again succeeded from persistent Cache Storage with
no network request. Browser checks passed for visible outlines at 100% satellite
opacity, imagery retained during pending and failed updates, standalone/combined
animation, timestamp matching/lag labels, explicit Map selection, and stale
request cancellation. No JavaScript errors were recorded. Real iPhone/Safari
storage, rendering, and memory behavior still need acceptance checks.

## 6 November 2026 — Prioritize the first satellite image

The user reported cold first-image waits measured in minutes. Caching only helps
repeat requests; the first frame also needed a smaller and better-prioritized
request path. These changes supersede the earlier 768/1024 scene-size defaults.

Measurements on this connection:

- Full WMS catalogue: 282,238 bytes, approximately 6.34 seconds.
- MTG-only catalogue: 34,870 bytes, approximately 1.74 seconds.
- Same Geo Colour scene at a 256-pixel maximum side: 79,598 bytes, 5.87 seconds.
- The previous 768-pixel maximum side: 613,523 bytes, 14.42 seconds.

These are individual requests, not guarantees for other connections or times.
The tested GeoWebCache WMTS catalogue route returned HTTP 400 (coverage reader
error); it was not adopted as a proven replacement.

The first request now targets the actual selected radar time, rounded back to
an available native satellite slot. Previously, newest-first loading could
spend time fetching newer images that could not be shown against a paused or
older radar frame. It now queues that matching frame and earlier observations
before newer ones. A selected radar time outside the normal history window adds
one matching slot, rather than expanding into an unbounded download window.

Catalogue requests filter by provider namespace (`mtg_fd` or `msg_fes`) and only
reuse an in-memory catalogue if the requested layer is present. Cold imagery
starts with a 256-pixel preview, using the exact same EPSG:3857 BBOX and overlay
corners as its later refinement. History requests do not compete with that first
preview. A cached prepared frame bypasses the preview request. The preview time
and preparation progress are displayed while higher-detail imagery loads.

Prepared history now uses 512-pixel maximum sides on smaller viewports and 768
otherwise. Refinement replaces the preview at the same timestamp instead of
creating a duplicate animation frame. Preview loading is limited to 10 seconds;
individual prepared-image requests retain their 20-second limit. The complete
update has a 60-second budget. Partial imagery is retained and incomplete
history is labelled for retry rather than continuing an open-ended wait.

Validation: a live cold-profile Chrome test showed the first image at about
2.54 seconds (catalogue about 0.54 seconds) and seven one-hour hybrid frames
ready at about 21.09 seconds. Deterministic browser checks confirmed that a
paused historical radar frame gets a matching preview first, no history request
starts before that preview resolves, and refinement leaves unique timestamps.
Caching checks still issued zero GetMap requests on repeat preparation.
Standalone/combined playback, opacity, outlines, failure retention, cancellation,
and registration after pan/zoom passed without JavaScript errors (placement
error approximately 0.51 CSS pixels). Real iPhone/network timings remain to be
measured; the app cannot guarantee remote-service response times.

## 6 November 2026 — Progressive playback, paired readouts, and zoom reuse

The user reported that enabling radar did not stop satellite animation, although
disabling radar did. Both toggle directions now stop the current clock before
changing its driver. Both readouts are shown together at the bottom of the map,
with original frame index/loaded count and Lisbon-local time. The legend and
status popup were moved above the readouts, leaving map attribution readable.
Selected-frame counts were removed from the satellite header summary.

The previous loader gave only the first observation a small preview, then loaded
larger images for the history and disabled playback until preparation completed.
It also rebuilt history for larger zoom changes. These behaviors are superseded.

All satellite overview history now loads at a maximum 256-pixel side. Two workers
start with the selected time and an earlier observation, so a slow newest slot
need not block an earlier valid image. Playback becomes available once two
observations are loaded. Remaining low-resolution frames arrive progressively.
Each play-through snapshots observation times rather than relying on mutable
array indices; insertion of older frames cannot jump the running clock. The
next loop or a new Play incorporates the newly available observations. Combined
playback during preparation begins within the available satellite time range.

Zoom now lets Leaflet reproject the loaded overview history without rebuilding
it or looking up a new catalogue. The paused observation can receive a separate
higher-detail viewport image through `satelliteDetail.js` (512-pixel maximum
side on smaller viewports, 768 otherwise). Only that time is requested. Detail
uses its own matching WMS BBOX/Leaflet corners and the same observation time;
the overview remains a fallback outside the detail rectangle. Refinement is
canceled on playback, product changes, or superseding viewport requests. It is
not performed while overview history is still loading. Refresh explicitly
prepares history coverage for a newly explored region when needed.

Validation: live Chrome and controlled browser delays passed both toggle
interruptions, playback while history remained pending, stable clock time during
frame arrivals, adoption of arrivals on the next loop, unique observation slots,
side-by-side readouts clear of attribution, and one-frame zoom refinement with
no change to the history generation or overview count. Both overview and detail
registration passed a two-CSS-pixel tolerance (overview about 0.51 pixels).
Memory/disk cache reuse, full-opacity outlines, standalone/combined animation,
and update-failure retention/cancellation passed without JavaScript errors.

In the final live one-hour hybrid sample, the first overview appeared at about
1.22 seconds and six available observations were prepared in about 7.88 seconds;
one unavailable observation was skipped. Other runs were slower, so these are
connection/service samples, not a latency promise. Real iPhone/Safari behavior
and the user's network timings remain acceptance checks.

## 6 November 2026 — Keep the clock through radar toggles and stabilize quality

The user clarified that radar check/uncheck should allow playback to continue,
reversing the previous stop-on-toggle request. Both visibility changes now
preserve the running timer, observation time, source cadence, and sequence.
The clock source is selected when Play starts and remains independent of layer
visibility. Both data sources render their most recent available observation
at or before that clock. If a source has no earlier data, its layer is hidden and
its readout shows a dash instead of presenting a future frame. Native source
observation times may differ and remain visible side by side.

Inspection found that a cached detailed frame could be used inside an otherwise
low-resolution animation. This is a concrete source of inconsistent sampling
that can look like cloud motion; it does not prove the cause of every reported
visual shift. Playback now uses overview imagery throughout. Detail is reserved
for paused inspection, uses the same requested time, and is not inserted into
an ongoing movie. Pausing/end-of-playback also retain the user's current map
view instead of automatically returning to the starting view. A complete
higher-detail animation batch is not downloaded or substituted in this version.

The set of eligible satellite observations is also frozen within each loop.
Late-arriving observations wait until the next loop instead of replacing an
already displayed observation at the same clock position. A paused detail
response is applied only if its exact observation remains selected; refinement
and map movement retain that selected observation rather than selecting a newly
arrived timestamp.

The user also compared Meteoblue's iOS cloud rendering and fast, closely spaced
frames. Reviewed Meteoblue's official provider and API documentation, verified
public five-minute rapid-scan and 15-minute Cloud Mask catalogues, and retrieved
a Cloud Mask image. Findings, source links, limitations, and the next isolated
cloud-only experiment are in [satellite service comparison](satellite-services.md).
Meteoblue documents EUMETSAT/Meteosat data and requires an API key for its external
tile API; no such key or subscription access has been assumed. The user's
reported two-minute satellite observation cadence is not independently verified.
No approximate cloud-colour filter or replacement satellite service was deployed.

Validation: Chrome checks passed uninterrupted check/uncheck (same timer and
clock), progressive loading/loop adoption, stable requested time during detail
loading, uniform overview quality throughout a movie with cached detail present,
zoom refinement without history reload, and numeric registration. Existing
cache, opacity, outlines, paired readouts, and update-failure tests passed with
no JavaScript errors. Real iOS comparison remains a device acceptance step.

## 6 November 2026 — Approved progressive coverage and Low/High comparison

The user approved the plan before implementation. This entry supersedes the
previous paused-only detail and manual coverage-refresh behavior.

- Low history requests run newest to oldest with two workers. Playback can start
  after two observations, repeats while loading even with Loop off, and adopts
  earlier arrivals at a pass boundary. If loading finishes before that boundary,
  newly extended history still gets a pass before Loop-off stops playback.
- Radar check/uncheck continues to preserve the playback source, timer, and UTC
  clock. Low history arrivals do not change a running pass's eligible times.
- Pan/zoom automatically prepares a new padded scene when existing scene reuse
  is unsuitable. The current movie continues; each old observation is replaced
  only by its same-time image for the expanded region. Cached URLs are reused.
- The explicit Low/High selector defaults to Low. High stages the complete set
  with the same timestamps and registered bounds at larger dimensions. Low
  stays visible until every High frame is ready. The batch switches at a pass
  boundary, including the end of a non-looping pass, or immediately when paused.
  Missing High frames retain Low. Low can be selected immediately, and both
  sizes remain in bounded memory/persistent caches.
- Removed automatic one-frame paused refinement, so individual quality changes
  no longer enter an otherwise uniform movie. Existing radar bounds and source,
  satellite projection, opacity controls, and outline pane remain unchanged.

Provider follow-up is in [satellite services](satellite-services.md). RealEarth
permits free public integration with attribution and usage limits, but no
suitable cloud-only photographic Portugal sequence was verified. EUMETSAT's
15-minute Cloud Mask remains a promising categorical overlay candidate; its
product-specific redistribution designation and a verified rendering prototype
remain outstanding. No API key, cloud-colour heuristic, or new cloud layer was
added to the application.

Validation includes live Chrome imagery plus deterministic delayed history/High
responses: newest-first order, playback with Loop off during loading, stable
clock through arrivals/toggles, boundary adoption, no High switch before complete,
uniform High playback, immediate Low/cached High reuse, incomplete High fallback,
automatic expanded coverage, no future-time pairing, side-by-side readouts, and
numeric projection placement. Existing cache persistence, opacity, full-opacity
outlines, update-failure retention, and stale-request cancellation are also
checked. Desktop Chrome uses a simulated mobile viewport; real iPhone/Safari
acceptance remains outstanding. Timings are service samples, not guarantees.

## 6 November 2026 — SkyFlow photographic-cloud still-image lab

The user chose the future name SkyFlow and wants worldwide coverage while
retaining IPMA radar in its valid Portuguese coverage. They explicitly approved
a separate comparison lab after reviewing its plan. Production renaming and
worldwide source selection are not part of this lab implementation.

The isolated page is [labs/clouds/index.html](../labs/clouds/index.html), with its
own styles, ES modules, bounded raw-image cache and comparison record. It loads
no production controller scripts. Linked maps compare the existing MTG GeoColour
reference against same-time MSG Natural Colour imagery clipped by MSG Cloud
Mask. A third map is explicitly inactive for Meteomatics until access and
redistribution terms are confirmed. No credentials or external-provider data are
used. This is stage one: still images over Portugal and nearby Atlantic/Europe,
with UTC selection, Low/High requests, opacity, automatic viewport reloads,
optional original-bounds IPMA radar and exportable measurements/visual notes.

Live masks contained mixed palette colours even with nearest-neighbour requested.
Strict decoding deliberately omits and reports those pixels. A separate
experimental palette-reconstruction option solves the four provider class-colour
contributions to restore resampled edges, preserving the original satellite RGB.
It does not guess cloud colour from the photograph or claim physical cloud
transparency. Inspect controls expose the original photograph and raw mask with
no extra source request. The default remains strict classification for comparison.

Implementation details, access limitations, reproducible checks and initial
measurements are in [cloud-lab.md](cloud-lab.md). Live comparisons and controlled
fixtures check texture preservation, transparency, UTC slots, shared geometry,
caching, stale loads, retained-image recovery and linked coverage. Original
production radar bounds and all production scripts remain unchanged.

## 6 November 2026 — Preserve GeoColour and draw map context above it

After inspecting the lab, the user preferred MTG GeoColour's photographic
appearance to the pixelated masked MSG experiment. They approved updating the
lab with geographic features above GeoColour. The lab now offers independently
switchable place names, major roads, and coastlines/borders, with a shared
strength slider. These vectors sit above satellite and optional radar at full
image opacity. Satellite pixels, requested time and source remain unchanged.

Local public-domain Natural Earth extracts supply 479 regional cities/towns and
1,992 major/secondary road features. The lab loads them once, filters by zoom,
and suppresses overlapping place labels. The original outlines remain in use.
No external label service or API key was added. This is regional weather-map
context, not a complete street map. Data provenance and a reproducible extraction
script are recorded in [data/README.md](../data/README.md). Feature settings are
included in comparison downloads. Production scripts are unchanged.

## 6 November 2026 — Detailed vector-map and Meteomatics comparisons

The user approved trying the full vector-map approach and requested removal of
photographic clouds+mask from panel 2. They confirmed they have no Meteomatics
access yet. The lab now compares (1) the regional-feature GeoColour reference,
(2) the identical GeoColour canvas/UTC slot on live OpenFreeMap vector cartography,
and (3) the optional Meteomatics photographic cloud product over that vector map.
The mask UI, conversion and MSG catalogue requests were removed from the lab.

Each vector panel uses one MapLibre renderer inside Leaflet. Base fills render
below weather image sources, and road/name/boundary layers above them, including
above optional radar. Linked pan/zoom, Low/High image requests, opacity and feature
controls remain independent. Both GeoColour views share one decoded image and
one public WMS request. A browser-compatible MapLibre build is pinned; vector
visibility/strength preserve the style's top-level zoom expressions.

Added a loopback-only Python lab server for the optional Meteomatics WMS request.
It reads credentials interactively or from environment variables, retains them
server-side, validates a fixed product and projected request geometry, and keeps
provider image caching in bounded memory. No account access, free satellite tier
or distribution permission is assumed. The panel clearly awaits access, while
fixture tests exercise the connector without an account. Real provider image
quality remains untested. See [current lab guide](cloud-lab.md) for exact local
commands and limitations. Production scripts remain unchanged.

Validation: live vector roads and text, identical GeoColour pixels/time, layer
ordering, visibility and strength, source opacity, linked pan/coverage and stale
responses passed in Chrome. A close Lisbon street view at Leaflet zoom 17 passed
with street names rendered and approximately 0.86 CSS-pixel image-corner placement
error. The measurement was corrected to exclude the map container's CSS border;
regional Leaflet/vector errors measured about 0.23/0.44 pixels. Provider fixtures,
mobile-width overflow checks and all five local connector tests passed. No real
Meteomatics image was fetched. Physical iPhone/Safari remains unverified.

## 6 November 2026 — Incorporate GeoColour vector rendering into ipma-radar

The user approved bringing the lab's map rendering and GeoColour into the main
application while explicitly retaining the existing map for Map view. The
existing `hybrid` product key now appears as **GeoColour satellite**; its EUMETSAT
product, observation times and cache keys are unchanged. Map remains the default.

Added `src/js/geoColourMap.js` with lazy MapLibre 5.6.2 / Leaflet-bridge 0.1.4
loading and the OpenFreeMap Liberty vector style. To preserve the working movie
and rain filtering, weather frames remain on their existing Leaflet overlays.
Two vector panes place base fills below satellite and transparent road/name/
boundary context above satellite and radar. Context opacity uses the lab's 85%
setting and preserves top-level style zoom expressions. Original radar bounds,
Low/High batch switching, progressive coverage/history and visibility toggles
remain on their established paths.

The original OSM tile-layer instance is restored for Map/Visible/Infrared, at the
same map location and zoom. GeoColour exit releases its GL layers; source style
and library downloads can be reused. Raster map zoom 19 remains explicit when
its tile layer is detached. Public-source attributions change with the active
renderer without accumulating duplicate credits. Natural Earth outlines remain
available for standard/fallback rendering. Detailed-map loading has an independent
floating status, avoiding changes to map height and satellite loading messages.
WebGL or map-service failure retains the original map and active weather layers.

Validation includes real satellite/radar data, rendered GL text, pane ordering,
full-opacity context, readable footer/credits, original Map restoration and
forced-WebGL-failure recovery, alongside existing progressive playback, cache,
quality, missing/stale image, opacity and registration checks. Physical iPhone/
Safari performance with two GL canvases remains a device acceptance check.
Final checks passed all three satellite views and the existing playback/cache/
quality/recovery suite without JavaScript errors. A close Lisbon street view
rendered real street names and measured about 0.5 CSS-pixel vector placement
error; satellite placement remained about 0.51 pixels. A 390-pixel viewport
screenshot confirmed readable labels and footer credits at 100% satellite opacity.
Meteomatics remains a lab-only connector awaiting account access; no paid source
or key was added to the production app.

## 6 November 2026 — GeoColour default, actual image dimensions and stable zoom coverage

The user requested GeoColour as the default, clear Low/High identification next
to frame counts, clarification of caching, and stable zoom-out handling. GeoColour
is now selected initially, with radar and satellite loading concurrently.
The satellite readout includes actual displayed quality and decoded image size;
selecting High does not imply High is displayed before its complete batch is ready.
These pixel dimensions are deliberately distinguished from native ground resolution.

Inspection confirmed that viewport updates previously replaced observations one
at a time, producing an animation alternating narrow rectangles and expanded
images. Added `satelliteCoverage.js`: a coverage change retains the old movie
unchanged while staging every matching observation in the new extent. It commits
the entire replacement between passes (including end-of-playback), or immediately
while paused, without moving the UTC clock. Requests remain newest to oldest.
Missing/timeout responses retain the old movie and show a persistent Refresh retry
message; successful partial downloads remain cached. Further viewport requests
discard stale prepared batches. Initial history still loads progressively, and
reframing while that load is incomplete preserves its full requested time roster.
High preparation waits until the new Low coverage has committed.

Cache behavior is now explicit in the README: satellite source PNGs have bounded
16 MiB memory and 48 MiB / 96-entry persistent caches, with memory fallback if
browser storage is unavailable. Radar has session-memory caching; base-map tiles,
vector fonts/styles and other network resources use browser/provider caching.
The app does not promise that every resource or previous scene stays cached.
A different geographic BBOX or output size is a different satellite cache key.

Validation: full Chrome checks passed GeoColour/visible/IR loading, actual Low/High
pixel readouts, uninterrupted old-movie playback while expanded images arrive,
complete replacement at a boundary, incomplete-coverage retention, paused commit
without clock movement, and full initial-history preservation across a reframe.
Existing caches, quality staging, radar toggles, registration, detailed vector
labels, original Map restoration and renderer fallback also passed with no
JavaScript errors. A 390-pixel viewport screenshot showed both readouts fitting
beside each other with image dimensions and clear of attribution. Physical iPhone/
Safari validation remains outstanding.

## 6 November 2026 — Four satellite workers and prepared-feed verification

Raised the shared Low history/coverage and High preparation request limit from
two to four. The earlier fixed-view eight-image comparison measured about 31%
less elapsed time with four workers; this is a measured sample, not a guarantee.
The quick Chrome suite passed loading, quality switching, coverage staging,
cache reuse, radar-toggle playback, registration and map fallback checks.

Verified CIRA SLIDER's public prepared Meteosat-12 GeoColour catalogue and PNG
tiles. At approximately 17:00 UTC its latest listed scan was 15:00, versus 16:40
for EUMETView. Its native satellite projection requires reprojection, and direct
browser catalogue/pixel fetches failed across origins. Public redistribution/API
terms remain unverified. Production therefore retains EUMETView. Full evidence,
timings and source links are in the
[prepared-feed investigation](geocolour-feed-investigation.md).

## Playback handoff after coverage and quality preparation

Separated initial history growth from replacement loading at the end of a
play-through. An expanded-view request no longer forces an extra pass with Loop
off. Coverage and High batches commit after the last observation: Loop starts
the replacement movie, while one-shot playback remains paused at the final time.
If preparation completes after playback has stopped, it leaves playback paused.
The High-ready status now describes switching after the pass, including when
Loop is off.

Validation: the quick Chrome suite passed with explicit coverage/High checks
for Loop on and off, an unfinished coverage request at the end of a one-shot
movie, late completion remaining paused, and a subsequent Play using the
replacement. Existing progressive history, cache, registration and fallback
checks also passed with no JavaScript errors.

## High-resolution fallbacks and persistent preparation counts

High preparation now finishes when every request has resolved or timed out,
using the matching Low observation wherever High is unavailable. The prepared
movie still commits between passes (or while paused) and follows the existing
Loop behavior. Successful retry images are staged separately so they cannot
change sharpness midway through a pass. Stale High images with different bounds
are removed at commit rather than used as fallbacks.

The satellite readout retains processed/ready counts during preparation and
the final High-ready/Low-fallback totals afterward, alongside actual displayed
quality and dimensions. A Retry High button appears for missing High images;
it reuses successful details and bypasses temporary failed-request deferral for
the missing ones. A finished partial batch does not retry automatically at every
playback boundary. Low selection cancels outstanding High preparation.

Validation covers mixed quality at matching observation times, persistent
counts, retry staging and boundary upgrades, explicit retry through failure
deferral, and the all-High-unavailable case, alongside the existing playback,
coverage, registration and cache checks.

## Automatic Low previews followed by High

Removed the production Low/High selector. Selecting any satellite product,
including startup GeoColour, now loads Low history first and automatically queues
High preparation after that history finishes. Reframed coverage queues High once
the complete new Low movie commits. High uses the existing four workers,
matching UTC observations and geographic bounds, cached successes, Low fallbacks,
and pass-boundary switching. Paused playback stays paused. Map selection or
another satellite request cancels stale preparation through the existing request
generations.

Persistent High counts, actual displayed image dimensions and Retry High remain.
Cache limits and geographic coverage margins are unchanged. There is no new
user-facing setting to disable High yet; that remains future work.

Validation includes a gated Low history proving that no High requests start
before Low finishes, automatic High startup with no selector action, and the
existing mixed-quality, retry, cache, coverage and playback checks.

## Remaining integration work

- Confirm iPhone/Safari behavior after the script split, asset moves, and satellite
  addition; desktop Chrome and a simulated mobile viewport have been checked.
- Evaluate a short, clearly labelled nowcast separately from observed history.
- Consider automatic refresh and independent radar/location status ownership.
- Scope radar CSS to a feature container before combining pages.
- Encapsulate radar state and expose initialization, resize, and cleanup methods.
- Receive beach selection and coordinates from PraiasPortugal's existing data.
- Coordinate refresh and navigation with the host application lifecycle.

These are future steps, not changes completed by the file reorganization.

## 7 November 2026 — Map startup, GeoColour preloading and High status placement

The satellite comparison retained all three products: GeoColour for general
viewing, Visible for daylight cloud detail, and Infrared for temperature-based
cloud structure during day or night. The user then chose **Map with Rain radar
checked** as the startup display. View order is now **Map → GeoColour → Visible
→ Infrared**. This supersedes earlier entries describing GeoColour as the
selected startup view.

GeoColour history preloads into the existing source-image cache while Map is
selected: finish the Low pass before starting High, using four workers and the
current viewport/history range. This background path creates no satellite
overlays or GeoColour vector map and does not change the visible Map/radar
selection. Selecting a satellite view cancels background warming; normal
satellite loading reuses cached images when bounds, size and timestamps match.
New observations or changed coverage can still require requests. Map movement
or history changes prepare the corresponding scene; this is not a guarantee of
instant switching or a continuously refreshed background feed.

Moved High processing/ready counts and final Low-fallback totals out of the
bottom satellite frame counter into `#satelliteHighStatus`, above the opacity
sliders. The bottom readout retains frame number, actual displayed quality and
decoded dimensions, and observation time. Retry High and pass-boundary quality
switching retain their existing behavior. Earlier entries describing High
processing totals inside the frame readout are historical.

Validation during implementation: Chrome checks passed Map/radar defaults,
Low-before-High background order, cancellation and cache reuse, High progress
placement and retry behavior, together with radar/GeoColour playback, coverage,
registration and failure recovery.

## 7 November 2026 — Dynamic sky header and review of the initial implementation

An Antigravity/Gemini implementation added the atmospheric header in
`skyTheme.js`, SVG artwork and CSS, documented in `sky-header-architecture.md`.
It included sun-dependent palettes, cloud tiers, an Open-Meteo temperature and
condition badge, rain, and decorative moon/stars. The visible title became
**Sky Flow**. The user approved the concept and requested corrections in this
standalone application; porting to PraiasPortugal remains deferred.

Review reproduced an older weather request replacing newer-location conditions
while the tooltip named the newer coordinates. It also confirmed that the SVG
stars rendered despite `hidden`, that the badge's display styling overrode its
hidden state, and that snow received a rain effect. Additional findings included
duplicate startup GPS requests, indefinitely retained weather after refresh
failure, and documentation overstating observation accuracy, astronomy,
accessibility and rendering cost.

### Startup location and weather-state corrections

- Reuse the map's single startup geolocation request. Resolve the banner once
  on GPS success, or use the map's `DEFAULT_LOCATION` on denial, absence or
  timeout. Do not reuse historical saved GPS coordinates as the current location.
- Keep the banner location fixed for the page session. Map pan/zoom and later
  Current location presses do not retarget it. Refresh weather every 15 minutes
  for that location; solar colours update every minute.
- Abort superseded requests and also reject late responses using generation and
  coordinate checks. Requests time out after 10 seconds.
- Preserve provider condition time and fetch time. Show condition time in the
  badge; mark data stale from 15 minutes and stop weather effects at 60 minutes.
  Expired/unavailable data retains solar colours with an unavailable message.
- Validate coordinates/timestamps, retain missing fields as missing, and use one
  explicit WMO mapping for condition text, icons and precipitation effects.
- Add an explicit header `[hidden]` rule, including SVG elements. Keep the moon
  explicitly illustrative: approximate phase, fixed position, no local rise/set
  or altitude calculation. Describe weather as model-based current conditions,
  not direct local station observations.

### Independent cloud percentages and rain/snow

Each cloud drawing receives its own model input. High uses `cloud_cover_high`,
Mid uses `cloud_cover_mid`, and Low uses `cloud_cover_low`. Their opacities are
the clamped percentage divided by 100, multiplied by 0.75, 0.85 and 0.95
respectively. Zero or missing cover draws none of that tier. Removed the opacity
floors that kept clear skies cloudy and the total-cover override that invented
low/mid clouds during high-only overcast conditions.

The source bands follow Open-Meteo: Low up to 3 km, Mid 3–8 km, High from 8 km.
Artwork remains fixed wisps, broad sheets and rounded puffs, with different blur
and decorative drift speeds. Percentages control transparency, not the literal
fraction of banner area occupied by clouds. The tiers overlap and must not be
summed or normalized. Total cover separately influences the palette and night
visibility. Species, actual wind, cloud depth and exact positions are not inferred.

Rain uses diagonal streaks; snow and snow showers use slower falling dots.
Freezing drizzle/rain keep liquid streaks with explicit freezing labels.
Thunderstorms use rain/storm presentation; hail is labelled without a separate
hail simulation. Rain and snow effects are mutually exclusive and independent
of radar echoes. Their animations stop with reduced-motion preferences along with the other
sky animations. There is no precipitation-intensity or accumulation simulation.

### User-directed presentation refinements and clipping fix

The temporary solid backing bars behind View, opacity and status rows were
rejected. Those rows are transparent again over the sky, using palette-dependent
text colours/shadows. The weather badge and heading have a separate mobile row
so they do not displace or overlap the playback controls.

Moved **Weather: Open-Meteo** from the heading to the map's bottom attribution
area, beside Leaflet and the map providers, with a CC BY 4.0 link. The weather
credit is independent of the base-map layer, so switching to GeoColour retains
it. Source attribution is still required; the banner no longer carries that link.

A horizontal line within the clouds was diagnosed as clipping at the SVG blur
filter region. Isolated Chrome screenshots compared the original, expanded SVG
overflow and expanded vertical filter bounds. Enlarging the filter region
removed the hard edge; overflow alone did not. The production fix changes all
three filters to `y="-100%"`, `height="300%"`, retaining `x="-20%"` and
`width="140%"`. The user confirmed the live result looked good after application.

### Evidence and next-use handoff

`tests/sky-header-check.py` passed deterministic Chrome checks for one startup
GPS request and weather request, default-location fallback, fixed coordinates,
independent and zero cloud tiers, rain/snow/freezing labels, hidden elements,
night visibility, stale/expired data, outdated-response rejection, cache reuse,
offline handling, invalid condition time, reduced motion and mobile overflow.
The existing quick Chrome suite also passed radar/GeoColour playback, staged
quality, caches, coverage, registration and map fallback checks. The later
attribution relocation was checked with the focused suite. Filter clipping has
isolated-browser visual evidence and user confirmation; it is not an automated
pixel-regression assertion. Physical iPhone/Safari performance and full
accessibility acceptance remain open.

Updated [sky header architecture](sky-header-architecture.md) as the authoritative
behavior specification and future PraiasPortugal handoff. It includes source
paths, API-to-drawing mapping, rendering limits, startup/freshness rules,
precipitation mapping, expanded filter bounds, host-component dependencies,
proposed lifecycle/cleanup contract, ordered implementation steps, acceptance
criteria and a copy-paste implementation prompt. Proposed encapsulation is
clearly distinguished from the current global-script implementation. No
PraiasPortugal code, component extraction or deployment was performed.


## 7 November 2026 — Coverage-driven cloud patches and precipitation intensity

Replaced the opacity-only cloud illustration with 24 stable SVG patches per tier.
Each tier's percentage activates and grows its own distributed patch budget;
full patches retain separate high/mid/low artistic opacities of 0.75/0.85/0.95.
The previous `cover / 100 × opacity maximum` formula in earlier entries is
historical. Zero/missing cover still creates no visible clouds, and total cover
does not manufacture missing altitude tiers.

Fixed patch ranks, vertical offsets and width variations avoid reshuffling on
refresh. High uses wisps, mid uses broad ellipses and low uses rounded puffs with
broad bases. Low/mid patches increasingly overlap toward a ceiling. Cloud SVGs
stretch to the banner's proportions with overscan and header-relative heights;
the expanded vertical blur bounds remain. Patch growth/opacity and tier opacity
transition over five seconds; reduced motion disables both transitions and drift.
Percentages control the active patch budget, not an exact fraction of pixels.

Added light/moderate/heavy precipitation presentation from explicit weather-code
classes: rain spacing and opacity, and snow density and opacity. Drizzle remains
subtle. Rain/snow remain mutually exclusive, independent of radar, and decorative;
no measured-rate or accumulation simulation was added.

Focused Chrome checks passed patch-budget growth at 20/60/95%, stable node reuse,
zero footprint, independent tiers, intensity classification and the existing
startup, freshness, cache, cancellation, visibility and reduced-motion checks.
Isolated desktop previews were inspected for sparse low cloud, near-overcast low
cloud and high-only cover. The architecture handoff now specifies patch generation
and limits instead of the superseded opacity-only behavior. Physical iPhone/Safari
appearance and performance remain a device acceptance check.


## 7 November 2026 — Independent cloud arrangements and drift phases

The user observed that the cloud layers appeared linked. Although durations were
separate, the old patch placement/ranking pattern was shared, animations started
together, and ease-in/out drift made relative movement subtle.

Each tier now has its own fixed placement seed, width variation and activation
ranking. Linear 320/240/160-second traversals start at distinct negative delays;
high/mid initially travel right at different rates and low initially travels
left. Each layer independently reverses at its overscan limit without jumping.
No wind data was added. Coverage growth, stable node reuse, expanded blur bounds,
five-second weather transitions and reduced-motion support remain.

Focused Chrome checks passed distinct layouts and sampled transform changes ten
seconds apart, confirming relative drift in addition to the existing sky checks.

Read-only inspection of PraiasPortugal confirmed its weather service/formatter,
data-manager and conditions-rendering structure. The weather service already
returns tier cloud cover and 10-metre wind; pressure-level winds are not requested.
The architecture handoff records concrete integration points and a possible
future wind-profile extension. No PraiasPortugal files were modified. Winds aloft
and physically meaningful screen projection remain future work.


## 7 November 2026 — Distinguish high, mid and low cloud textures

The user found the tiers visually similar. Replaced the common soft-blob look
with fine feathered high-cloud strands, broken flattened mid-cloud sheets and
low-cloud scallops with a flatter base. Low uses three stable outlines, height
variation, faint crest highlights and a soft underside gradient. High varies
strand tilt; mid varies sheet thickness. These are illustrative altitude-family
textures, not an inference of cloud species from model cover percentages.

Reduced shared SVG blur deviations to High 1.8, Mid 3.5 and Low 1.5 to preserve
the texture differences. Retained expanded filter bounds, patch coverage/growth,
independent phases/drift and reduced motion. Focused Chrome checks passed for
existing sky behavior; isolated tier previews were visually inspected at equal
cover and near-overcast low cover. Updated the architecture handoff to include
the artwork and shared low-cloud shading gradient. Physical iPhone acceptance
remains open.


## 7 November 2026 — Soften the rejected symbolic cloud textures

The user rejected the sharp strand/scallop version as bizarre and unrealistic:
wisps read as lines across other clouds, mid cloud appeared too dark, and the
forms felt symbolic rather than atmospheric. Replaced high strokes with faint
filled tapered veils, simplified mid into pale uneven sheets, and removed low
crest highlights and mid internal dark lines. Blur is now High 8, Mid 7, Low 5;
the earlier 1.8/3.5/1.5 texture settings are superseded. Low underside shadow is
reduced to 0.12. All tiers share the selected palette's illumination colour,
rather than assigning darkness by altitude.

Retained independent cover, stable arrangements, growth transitions, separate
phase/drift, precipitation and reduced motion. Inspected individual tier and
near-overcast still previews; the current artwork remains an illustration, not
a cloud-species observation. The architecture document records the replacement
and its interpretation. The review targets the combined composition as well as
isolated layers, avoiding acceptance based solely on distinguishable symbols.


## 7 November 2026 — Accepted interim sky checkpoint and next steps

The user accepted the softer composition for now but explicitly stated that it
is still not ideal. Preserve this version as the interim baseline. This does
not establish visual realism, complete device acceptance or begin the
PraiasPortugal port. No additional visual implementation was requested at this
checkpoint.

Current treatment: faint high veils, pale mid sheets, uneven low masses with
gentle underside shading; shared illumination; blur High 8/Mid 7/Low 5;
independent coverage, patch arrangements, growth and drift phases. The earlier
sharp fibers, dark mid-cloud treatment and conspicuous low highlights were
rejected. Weather, rain/snow intensity, freshness, cancellation, reduced motion,
transparent control rows, attribution and the clipping correction remain.

Remaining concerns include procedural repetition, artificial overlap, tiers
merging and the gap between patch-budget cover and literal cloudy area. Altitude
percentages do not identify cloud species or reconstruct the physical sky. The
user knows of no good example; no external exemplar was researched or validated
at this checkpoint.

Next visual work should use a separate reversible comparison lab, fixed weather
and viewport fixtures, still compositions before motion, a small number of
alternatives and visual acceptance before replacing the baseline. Prioritize
the combined sky, natural edges and restrained lighting/motion over recognizable
symbols. Winds aloft remain optional and lower priority. Porting is a separate
future task.

The [architecture handoff](sky-header-architecture.md#current-checkpoint--accepted-interim-appearance)
now leads with the accepted status, limitations and ordered next steps. Its
implementation prompt is explicitly for a later authorized port. README links
to that checkpoint. This update changes documentation only: previous Chrome and
visual-preview evidence is retained without claiming a new test run. Physical
iPhone/Safari performance and full accessibility acceptance remain pending.

## 7 November 2026 — Immediate first cloud appearance

The user requested that clouds appear promptly on opening rather than grow into
view. Cloud transitions are disabled until the first usable weather snapshot's
target styles are committed; the header then sets `data-sky-clouds-ready` to
enable five-second transitions for subsequent updates. Initial cached and
network weather follow the same rendering path. Retrieval can still take time;
no speculative cloud state is shown before usable weather arrives. Independent
drift and reduced-motion behavior are retained. This is a startup presentation
adjustment to the accepted interim artwork, not a new visual design.

The focused browser check now starts with cloudy weather and checks the first
state's actual opacity and absence of running cloud transitions, plus the
five-second transition configuration for later updates.

## 8 November 2026 — Combined radar and satellite timeline

Previously, starting playback with radar enabled selected radar's observations
as the clock. A short radar history could skip most satellite observations;
starting satellite-only and enabling radar later retained a different clock.
Playback and Previous/Next now use the sorted union of successfully loaded
timestamps from both enabled layers. Each source keeps its most recent image
at or before the selected time, remaining hidden before its first observation.
Actual source timestamps remain visible. Disabling both layers stops playback.

The running pass retains its snapshot. New observations join at the next
boundary, including a satellite image whose timestamp already exists in the
radar timeline. Radar toggles retain the current pass and the next pass uses
the enabled layers. Initial history growth still repeats until the expanded
history can play; Loop continues to control completed playback. Existing
coverage and High-resolution replacements retain their boundary policy.

Map view already schedules background GeoColour preparation after a 400 ms
debounce. The catalogue supplies the newest observation and cadence, from which
the selected history's expected count and span are calculated before image
loading finishes. This is an expected roster, not a guarantee of image
availability. The timeline uses successful downloads without waiting for the
entire roster. No extra startup request or image-loading path was added.

Validation: `python3 tests/browser-check.py` passed with live GeoColour,
Visible and Infrared, existing progressive/High/coverage/cache/recovery checks,
and new deterministic seven-radar/19-satellite fixtures. Fixtures verify all
observations, differing timestamp minutes, holds in both layers, no future
images, stepping/wrapping, toggle order, boundary adoption, overlapping late
arrivals, Loop off, and Map-only/no-layer timelines. Live catalogue responses
were about 167–323 ms in this run; these are samples rather than a startup
latency guarantee. `git diff --check` passed. Physical iPhone/Safari acceptance
remains to be checked for combined playback and toggling.


## 8 November 2026 — SkyFlow displayed branding

Build `2026-11-08.3` changes the browser title, visible heading, manifest name
and short name, and build tooltip to **SkyFlow**. The manifest description and
current documentation introduction now describe satellite imagery and IPMA rain
radar. The existing icon has no old-name text and is retained.

The repository name, public URL, manifest start URL, storage/cache keys, provider
credits and archived records retain their existing values. No repository rename,
hosting change or deployment is part of this branding update.

Validation: manifest JSON and `git diff --check` passed. Isolated Chrome checks
at 320, 390 and 1280 pixels verified the SkyFlow title/heading, build label and
unchanged manifest start URL. The live quick suite found the mobile credits
could overlap the frame counter; mobile frame/status readouts now sit 24 pixels
higher, and the credit-clearance check passed on subsequent runs. An older
combined-playback assertion now checks clock advancement rather than requiring
radar to advance during a valid held-image interval. Playback fixtures and
progressive/replacement/cache checks passed in the run reaching those sections.
The final two full quick-suite attempts stopped at the live street-name tile
check; a complete final suite pass is not claimed. Physical iPhone installed-name
acceptance remains separate.

## 8 November 2026 — High-contrast current-location marker

Build `2026-11-08.4` replaces the small translucent location dot with a 14 px
opaque blue center, 3 px white ring and 2 px black outline (24 px total).
The marker uses Leaflet's marker pane above radar, satellite and map context,
with its anchor centered on the GPS coordinate. It has no animation and does
not intercept map input. The existing accuracy circle and GPS flow are retained.
The light/dark rings provide contrast without relying on red–green differences;
final personal visibility acceptance remains with the user.

Validation: the existing sky/startup GPS browser suite passed. A focused mobile
Chrome check with mocked GPS verified the exact dimensions/colors, geographic
centering, layer order and retained accuracy circle in Map, GeoColour and
Infrared. Live satellite histories loaded in both satellite views. Screenshots
were inspected in all three views. A repeated GPS success replaced the previous
marker without leaving duplicates. `git diff --check` passed.

### Location marker transparency — build 2026-11-08.5

At the user's request, the blue center and white ring now use fixed 65% opacity;
the black outline remains fully opaque. The white ring uses an inset shadow
rather than a background beneath the center, so white and blue transparency do
not compound and obscure the map underneath. Dimensions and GPS behavior remain
the same.
