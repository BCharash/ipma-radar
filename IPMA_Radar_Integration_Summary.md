# IPMA Radar — Integration Handoff / Technical Summary

## Purpose

This document describes the current standalone IPMA Radar app and the decisions that produced it. It is intended as the technical handoff for incorporating the radar into **Praias de Portugal**.

The key architectural point is that this is not a generic radar layer: it uses IPMA's actual radar PNG products and registers them using the geographic bounds used by IPMA itself.

## Current feature set

- Leaflet + OpenStreetMap base map.
- IPMA mainland Portugal precipitation radar.
- Current-location positioning, with fallback near Praia de Santa Rita.
- 1, 2, or 3 hours of history.
- 5, 10, 15, or 20 minute frame intervals.
- Previous / Play-Pause / Next controls.
- Smooth playback by preloading and decoding frames before animation.
- Automatic discovery of the newest image actually published by IPMA.
- Manual Refresh.
- Frame counter showing frame number and Lisbon local time.
- PWA manifest, iPhone home-screen icon, and favicon.
- Vertical precipitation-intensity legend in the lower-left.

## 1. IPMA image acquisition — the critical decision

Do **not** depend on `imgs-radar.json`.

The IPMA JSON endpoint used to enumerate radar images is CORS-blocked when requested from the app's local/GitHub Pages origin. The successful solution is to request the PNGs directly.

Base path:

    https://www.ipma.pt/resources.www/transf/radar/por/

Filename pattern:

    pcr-YYYY-MM-DDTHHMM.png

The timestamp in the filename is UTC.

This direct-PNG approach is preferable because the app can test the actual image URL and determine what IPMA has really published, rather than depending on a separate index or on the state displayed by IPMA's webpage.

## 2. Finding the newest actual image

Radar imagery is produced on a five-minute grid, but publication can lag the nominal timestamp. The app therefore does not simply assume that the current five-minute image exists.

It starts with the current five-minute UTC candidate and checks backward through recent five-minute timestamps until it finds an image that actually exists. The current search window is up to 30 minutes.

**Do not introduce an artificial publication delay.** The desired behavior is to display the newest image IPMA has actually made available. In testing, the direct PNG approach could sometimes obtain a newly published image before IPMA's public radar webpage had updated its own displayed state.

## 3. Authoritative map registration — the other critical decision

The radar PNGs must be registered to Leaflet using IPMA's own geographic bounds.

The authoritative bounds found in IPMA's `mapbuilder-pt.js` are:

    const RADAR_BOUNDS = [
      [34.011513, -12.454795],
      [43.792862, -4.345465]
    ];

That is:

    southwest: 34.011513, -12.454795
    northeast: 43.792862, -4.345465

Use these exact values when constructing the Leaflet `ImageOverlay`.

Do **not** substitute a guessed Portugal bounding box.

The PNG is simply an image; Leaflet needs geographic bounds to know where to place it. Using IPMA's own bounds avoids reverse-engineering or approximating the image geometry and is therefore the most reproducible solution.

## 4. Leaflet / animation architecture

Each radar frame is represented by a Leaflet `ImageOverlay` using the IPMA PNG URL and `RADAR_BOUNDS`.

The app:

1. Builds the requested timestamp sequence.
2. Preloads every requested image.
3. Decodes the images.
4. Removes frames that IPMA did not actually supply.
5. Creates the complete set of Leaflet overlays.
6. Animates by switching overlay visibility.

This gives smooth playback without making animation dependent on network latency. The current playback delay is about 180 ms per frame.

## 5. History and frame numbering

The default history is 3 hours.

At a 5-minute interval this gives:

    36 intervals + both endpoints = 37 frames

Frame numbers are positional, not permanent image identifiers.

For example:

    Image 1  = 11:20
    ...
    Image 37 = 14:20

After a new 14:25 image becomes available:

    Image 1  = 11:25
    ...
    Image 37 = 14:25

Thus the oldest frame falls out of the rolling three-hour window. The actual identity of a frame is its timestamp.

Browser HTTP caching is separate from the application's `radarFrames` array.

## 6. Refresh

The Refresh button calls the existing `rebuildRadar()` function. No second loading mechanism is needed.

`rebuildRadar()` stops playback, rebuilds the timestamp list, finds available IPMA images, preloads/decodes them, filters unavailable images, reconstructs the overlays, starts at the newest frame, and updates the counter.

The UI also reports **“Radar is current”** briefly when Refresh finds that the newest available timestamp has not changed.

## 7. Time display

IPMA filenames contain UTC timestamps. The user-facing frame counter converts them to:

    Europe/Lisbon

using JavaScript `Intl.DateTimeFormat`. This automatically handles Portugal's daylight-saving transition.

## 8. Intensity legend

The app has a compact vertical legend in the lower-left of the map. This location works well because the left side of the radar image is largely Atlantic Ocean and the Leaflet attribution is on the right.

The actual IPMA precipitation-intensity thresholds are:

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

The numerical scale is particularly useful for interpreting the radar independently of color perception.

## 9. Positioning

Current fallback:

    lat: 39.0867
    lon: -9.3777
    zoom: 7

This is near Praia de Santa Rita.

When geolocation succeeds, the map centers on the user's position and uses at least zoom 8. When integrated into Praias de Portugal, the fallback can be adapted to the main application's normal starting location.

## 10. Why this is the preferred solution

### Direct IPMA PNGs

They are the actual source products, avoid the CORS-blocked JSON index, expose deterministic timestamped URLs, and allow the application to discover what IPMA has actually published.

### IPMA's own geographic bounds

They eliminate guesswork and ensure the image is geographically registered according to IPMA's own map geometry.

### Preloaded ImageOverlays

They make playback smooth and independent of network latency.

### Rebuilding on Refresh

It creates a rolling, timestamp-based history without complicated permanent cache management. Old frames naturally fall out as new ones arrive.

## 11. Integration into Praias de Portugal

Treat the radar as a self-contained component. Preserve these core pieces:

1. `RADAR_BOUNDS`
2. Direct IPMA PNG URL construction
3. Latest-available-frame discovery
4. Frame-list construction
5. Image preloading/decoding
6. Leaflet `ImageOverlay` creation
7. Playback controls
8. Refresh / `rebuildRadar()`
9. UTC → `Europe/Lisbon` timestamp formatting
10. IPMA intensity legend

The larger beach application can provide its own surrounding navigation and UI while preserving this radar engine.

## 12. Do not regress these decisions

- Do not replace direct PNG acquisition with `imgs-radar.json` unless CORS has independently changed and been tested.
- Do not replace `RADAR_BOUNDS` with guessed Portugal bounds.
- Do not assume the newest nominal five-minute timestamp is already published.
- Do not add an artificial delay because IPMA's webpage may show an older frame.
- Do not make playback download frames one at a time.
- Do not treat frame numbers as permanent image identifiers.
- Do not replace the IPMA intensity scale with an invented simplified scale.
- Do not lose the UTC → `Europe/Lisbon` conversion.

## Current status

The standalone IPMA Radar is a known-good, usable reference implementation.

The next step is integration into **Praias de Portugal**, preserving the radar acquisition, geographic registration, frame management, playback, refresh, and timestamp logic while adapting the surrounding UI to the main application.
