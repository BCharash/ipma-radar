# IPMA Radar — Integration Handoff / Technical Summary

## Purpose

This document is the current handoff for incorporating the standalone **IPMA Radar** into **Praias de Portugal**.

It supersedes the earlier investigation handoff dated 27 August 2026. The earlier document contains valuable investigation history, but some of its implementation details were subsequently changed. This document describes the **current known-good implementation** and also preserves the most important lessons from the investigation.

The central technical conclusion remains: use IPMA's actual timestamped radar PNGs and register them with the exact geographic bounds used by IPMA's own Leaflet implementation.

---

# 1. Current application

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
- PWA manifest and iPhone home-screen icon support.
- Favicon.
- Vertical precipitation-intensity legend.
- IPMA precipitation-rate thresholds in the legend.
- Public GitHub/GitHub Pages deployment as the intended hosting model.

The standalone version should be regarded as the **known-good reference implementation** during integration.

---

# 2. The most important architectural decision: obtain the actual IPMA PNGs directly

## Do NOT depend on `imgs-radar.json`

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

# 3. Finding the newest actual image

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

# 4. Authoritative radar geographic registration

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

## These values are authoritative, not estimated.

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

# 5. Why the earlier registration was wrong

An earlier implementation used approximately:

    [31.98944, -10.96436]
    [42.03297, -2.85645]

Those bounds were wrong.

They caused the radar pixels to be geographically stretched/positioned incorrectly, including an apparent extension too far into Spain.

This was not merely a map viewport problem.

There are two completely different concepts:

### Map extent / viewport

Controls what portion of the geographic map the user sees.

### ImageOverlay bounds

Determine where the radar PNG's pixels are geographically located.

Changing the map center or zoom cannot correct an incorrectly registered radar overlay.

**For integration, preserve `RADAR_BOUNDS` exactly.**

---

# 6. Independent confirmation from IPMA's map settings

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

# 7. Radar image dimensions and what they do — and do not — tell us

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

# 8. Frame construction and rolling history

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

# 9. Current playback architecture

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

### Important correction to the old handoff

The earlier investigation document described an implementation using one overlay whose URL was changed with `radarLayer.setUrl(frame.url)`. That is **not the current implementation**.

For future work, treat the current preloaded multi-overlay implementation as the baseline because it is the version that was actually tested and judged to give good smooth playback.

---

# 10. Refresh architecture

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

# 11. Loading/performance architecture

An important lesson from the earlier investigation is that radar history loading and playback are different problems.

The current implementation prioritizes **reliable complete playback** by preloading and decoding the requested frame set before constructing the animation.

This differs from an earlier experimental strategy that displayed the newest frame first and loaded older frames in background batches.

That earlier strategy was useful during investigation, but the current preloaded implementation is the known-good baseline because playback is smooth and predictable.

If performance optimization is revisited later, preserve the following principle:

> Optimize loading without sacrificing the smooth, already-loaded playback behavior.

Do not revert to downloading frames one at a time during animation.

---

# 12. Time handling

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

# 13. Intensity legend

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

---

# 14. Map viewport versus radar registration

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

# 15. Original investigation lesson: make sure debugging is happening in the correct page

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

# 16. Repository and hosting

The standalone project repository is:

    https://github.com/BCharash/ipma-radar.git

Repository name:

    ipma-radar

The project is intended for public GitHub Pages hosting.

Do not confuse this with the earlier conversationally mentioned “IPMA Test” repository; that name was erroneous.

The standalone project should remain available as a reference while the radar is integrated into Praias de Portugal.

---

# 17. PWA / browser assets

The standalone app includes:

    index.html
    manifest.json
    icon-192.png
    icon-512.png
    apple-touch-icon.png
    favicon.png

`index.html` includes the manifest, Apple touch icon, and favicon references.

This is relevant when moving the radar into the larger application: the radar itself does not necessarily need to retain these as separate assets if Praias de Portugal already has its own PWA identity. The important point is to avoid accidentally removing the main application's existing PWA configuration while integrating the radar.

---

# 18. Things deliberately excluded

Satellite imagery was investigated earlier but was explicitly excluded.

Do not reintroduce satellite view unless specifically requested.

The radar component should remain focused on the IPMA precipitation product.

---

# 19. What should be carried into Praias de Portugal

Treat the following as the radar core:

### Acquisition

- Direct IPMA PNG URLs.
- Timestamp-based filename construction.
- Five-minute timestamp grid.
- Latest-actually-available search.
- 30-minute backward search window.

### Geographic registration

    const RADAR_BOUNDS = [
      [34.011513, -12.454795],
      [43.792862, -4.345465]
    ];

### Frame management

- History selection.
- Interval selection.
- Timestamp-based frame identity.
- Rolling history.

### Loading and playback

- Preloading.
- Image decoding.
- Filtering unavailable frames.
- Leaflet ImageOverlays.
- Smooth playback using already-loaded frames.

### User controls

- Previous.
- Play/Pause.
- Next.
- Refresh.

### User feedback

- Loading status.
- “Radar is current”.
- Frame number.
- Lisbon-local timestamp.

### Accessibility / interpretation

- Numerical IPMA precipitation-intensity legend.

---

# 20. Things NOT to regress

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
- accidentally debug the IPMA website instead of the integrated application.

---

# 21. Integration strategy

The safest approach is:

1. Preserve the standalone radar as a known-good reference.
2. Identify the radar-specific functions and constants in the standalone `index.html`.
3. Integrate those pieces into the Praias de Portugal map architecture.
4. Preserve `RADAR_BOUNDS` unchanged.
5. Preserve direct IPMA PNG acquisition unchanged.
6. Preserve timestamp handling and latest-frame discovery.
7. Preserve preloading/playback behavior initially.
8. Adapt only the surrounding UI, map lifecycle, and beach-specific positioning.
9. Test the integrated version against the standalone version before adding further optimization.

Do not simultaneously change acquisition, geographic registration, playback, and UI. If something fails, the changes will otherwise be difficult to diagnose.

---

# 22. Testing checklist for the integrated version

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

# 23. Recommended future refinement

The earlier investigation considered reducing the history to approximately four hours at 10-minute intervals, giving roughly 25 frames.

The standalone app was subsequently stabilized with a 3-hour default and selectable 5/10/15/20-minute intervals.

Therefore:

**Do not change the current history configuration merely because the old handoff mentioned four hours.**

If a longer history or different default is desired in Praias de Portugal, make that a deliberate product decision after the radar has been integrated and tested.

---

# 24. Central insight to preserve

The most important conclusion of the entire investigation is:

> **IPMA itself uses the timestamped public radar PNGs as Leaflet ImageOverlays and registers the Portugal radar with the exact bounds:**

    [34.011513, -12.454795]
    [43.792862, -4.345465]

The bounds were discovered by examining IPMA's own `mapbuilder-pt.js`.

The earlier Spain-registration problem was not a mysterious transformation issue. It was caused by registering the radar PNG against incorrect geographic bounds.

The current implementation is therefore based on IPMA's own acquisition and registration logic rather than an approximation.

---

# 25. Final handoff summary

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
