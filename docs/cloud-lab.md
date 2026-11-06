# SkyFlow cloud comparison lab

Open [the separate lab](../labs/clouds/index.html) using Live Server. From the
running app's origin, visit `/labs/clouds/`. The lab does not load the production
controller, change the app name, or share its satellite cache. Stage one compares
still images over Portugal and nearby Atlantic/Europe; animation and worldwide
source selection remain future stages.

## Comparisons

1. **GeoColour with map features:** `mtg_fd:rgb_geocolour`, the app's existing
   full-scene product, preserved without masking. Place names, major roads,
   coastlines and country boundaries are drawn above it, even at 100% image
   opacity.
2. **Photographic clouds:** `msg_fes:rgb_natural` combined with `msg_fes:clm` at
   the same requested UTC slot, projection, bounds and pixel dimensions. Cloud
   pixels retain the original photograph's RGB values; clear/no-data areas have
   zero alpha. Natural Colour includes a near-infrared channel; ice clouds can
   look cyan. It is textured satellite imagery, not a plain white cloud mask or
   necessarily human-eye true colour.
3. **Meteomatics:** an inactive map slot, clearly labelled without provider data.
   Its documented `sat_cloud_layer:idx` is the intended future comparison, once
   access and permitted distribution are established. No credentials are read,
   stored or requested by this lab.

The two active comparisons have different satellite instruments/products. Use
**Inspect → Original photograph / Classification mask / Cloud-only photograph**
on panel two to isolate what masking does to its own source. Do not attribute
all differences between panel one and panel two to the transparency algorithm.

## A useful first session

1. Leave **Latest common time**, **Low**, and **100% opacity** selected. The latest
   common slot may lag each individual product's newest image.
2. On GeoColour, compare the **Place names**, **Major roads**, and **Coastlines &
   borders** switches and **Strength** slider. These change geographic context
   immediately without changing satellite pixels, time, opacity or loading.
   Inspect cloud texture, clear areas and coastlines. Switch panel two between
   the original photograph, raw mask, and cloud-only photograph without loading
   more data. Local outlines remain above imagery at any opacity.
3. Compare **Exact classes only** with **Reconstruct palette blends**. The first
   deliberately omits noncategorical pixels and reports their count. The second
   reconstructs mixed mask pixels as described below. Inspect thin clouds and
   edges especially carefully.
4. At the same selected time, compare **Low (256 px)** and **High (768 px)**. These
   are maximum requested image dimensions, not a claim of higher native sensor
   resolution. The two sizes have separate cache keys.
5. Use **Bypass lab cache**, then **Reuse lab cache**. Record per-panel elapsed
   time, memory/disk/network origin, and returned bytes in the JSON download.
   Bypass skips lab cache reads and uses fetch `no-store`; it does not empty the
   browser, base-map, provider or intermediary caches. Successful bypass loads
   populate the lab cache for the following comparison.
6. Pan or zoom any map. All maps follow and request a common expanded image grid
   after a 500 ms debounce. The old images remain explicitly timestamped until
   replacement imagery is ready. Failed loads retain the previous image.
7. Enable **IPMA radar** if useful. Its requested image is at or before the selected
   UTC time, trying preceding five-minute slots up to 30 minutes back. It uses
   the app's original IPMA bounds. Its timestamp and availability are separate
   from the satellite comparison.
8. Add visual notes and **Download comparison record**. Save the transparent
   cloud PNG if useful and take a browser screenshot of the maps. The PNG has
   no basemap or embedded georeferencing: retain the JSON record for its BBOX,
   projection, observation slot and source URLs. Take separate daylight, sunset
   and nighttime records; the Natural Colour experiment needs sunlight.

## GeoColour map features

This option preserves the complete MTG image. It does not extract clouds or
reveal the underlying street-map surface; it places transparent vector context
on top. Names have a light halo for visibility against bright/dark cloud and
surface areas. Roads use fine coloured lines with a light casing. Place-label
priority and overlap checks limit clutter; more names and secondary roads appear
as you zoom. Controls apply to all comparison maps and remain independent of
image opacity and optional radar. Defaults are enabled at 85% strength.

Local public-domain Natural Earth place/road extracts cover the same regional
rectangle as the existing outlines (longitude -40..15, latitude 25..55). Roads
are generalized major/secondary highways; places are selected cities/towns,
not all streets or settlements. This lab adds no map-service account or key.
See [data provenance and regeneration](../data/README.md). Features outside this
regional dataset remain a future worldwide-source decision.

The download records current map-feature settings and snapshots them for each
imagery run. Feature switches do not cause satellite requests. Browser checks
verify Lisbon/Porto labels and roads above fully opaque imagery, visibility and
strength controls, and unchanged satellite pixels/overlay through those controls.

## Spatial and temporal controls

All requests use WMS 1.1.1 `SRS=EPSG:3857`. One shared snapped projected rectangle
covers all three map viewports, with identical BBOX and dimensions for the image
and mask. Leaflet overlays use the geographic corners obtained by unprojecting
those exact projected corners. The comparison record includes a corner/centre
placement check in CSS pixels. This checks application placement, not instrument
navigation, cloud parallax, ground-level rain, or the cloud-mask classification.

The lab reads product-specific time ranges and cadences from namespace-filtered
WMS catalogues. Initially it chooses the newest common advertised slot for all
three products. A manually selected time snaps each comparison backward to
available slots, never forward. The texture and mask always share an exact
common slot. The GeoColour offset and the difference between panels are explicit.
Requested catalogue slots are not independently verified acquisition timestamps:
the WMS can use nearest available data internally. Do not claim exact temporal
matching beyond what the service makes observable.

A new observation, resolution, or viewport cancels superseded requests. Each
panel commits its complete still image independently; imagery and mask are never
shown half-prepared. Retained older panels carry their own timestamps. There is
no animation in this stage and no inference of motion or future cloud positions.

## Mask palette and edge experiment

Provider palette observed in PNG samples, consistent with the provider guide:

| RGB | Meaning | Exact-mode alpha |
| --- | --- | --- |
| 255,255,255 | Cloud | Original photograph's alpha |
| 0,192,0 | Clear land | 0 |
| 0,0,255 | Clear water | 0 |
| 0,0,0 or mask alpha 0 | Unprocessed/no data | 0 |
| Other | Mixed/unrecognised | 0, reported |

Requests specify `interpolations=nearest neighbor` and disable antialiasing, but
live returned images still contain mixed colours. Exact mode therefore remains
the conservative default rather than guessing a threshold on the photograph.

The optional palette reconstruction assumes those mixtures come from resampling
the four known palette colours. Their contributions solve:

```
cloud = R / 255
land  = (G - R) / 192
water = (B - R) / 255
noData = 1 - cloud - land - water
```

Only feasible mixtures, allowing a small channel-rounding tolerance, are used.
The original photo alpha is multiplied by the reconstructed cloud contribution
and the mask alpha. Infeasible colours remain transparent and counted as
unrecognised. The record distinguishes exact cloud, clear, reconstructed and
unrecognised pixels. This is an experimental reconstruction of resampling
coverage, **not cloud optical thickness or physical thin-cloud transparency**.
It requires review if the service palette/style changes. Original RGB cloud
texture is never replaced with a synthetic white fill.

The lab cache contains raw PNGs only (24-entry/16 MiB memory cap and
48-entry/32 MiB persistent cap). Derived renders are recomputed, so changing
edge policy cannot reuse an incompatible processed image. Cache Storage is
optional; memory/network paths remain usable when it is unavailable.

## Sources and access

- [EUMETView](https://view.eumetsat.int/), public WMS, no key.
- [Cloud Mask product guide](https://user.eumetsat.int/s3/eup-strapi-media/pdf_clm_pg_6b00d53e6b.pdf).
- [Natural Colour description](https://view.eumetsat.int/productviewer/productDetails/msg_fes%3Argb_natural?v=default).
- [GeoServer sampling parameters](https://docs.geoserver.org/main/en/user/services/wms/vendor/#interpolations).
- [Meteomatics photographic cloud overlay](https://www.meteomatics.com/en/api/available-parameters/satellite/).
- Local Natural Earth outlines: [provenance](../data/README.md).

No commercial-provider account, free tier, or right to distribute derived cloud
images is assumed. Product-specific redistribution terms remain part of provider
selection before distributing derived assets or adopting this source in the app.

## Validation and findings

Run on macOS with Google Chrome installed:

```sh
python3 tests/cloud-lab-check.py
```

The suite uses an isolated Chrome profile and local server, live catalogue/PNG
requests, and controlled raster fixtures. It checks RGB preservation, clear-area
alpha, palette reconstruction, unknown-class reporting, identical pixel grids,
UTC snapping, cache reuse, Low/High requests, projection placement, linked pan
and automatic coverage, stale-load cancellation, and failed-load retention.
It also checks optional IPMA imagery and the mobile layout. Network failure can
fail live checks. Screenshots are written to `/private/tmp/skyflow-cloud-lab-desktop.png`
and `/private/tmp/skyflow-cloud-lab-mobile.png`.

Initial live sample on 6 November 2026, requested UTC slot 11:30:

- Both active comparisons used the same slot and a 256 × 256 image grid.
- One sample loaded GeoColour in 3.55 s and the texture+mask result in 3.89 s;
  another loaded in 2.66 s and 1.81 s. These are observed network-path samples,
  not cold upstream-cache benchmarks or a performance guarantee.
- Strict mask decoding counted 42,404 cloud, 16,731 clear, and 6,401 mixed/
  unrecognised pixels (about 9.8%). This is a concrete reason to compare the
  palette reconstruction with the raw mask instead of silently discarding edges.
- Optional palette reconstruction accounted for 6,400 of those 6,401 mixed
  pixels; one remained unrecognised and transparent. This supports testing the
  reconstruction visually, not treating it as independent cloud truth.
- Placement error at three projected reference points was about 1.59 CSS pixels,
  within the two-pixel rounding tolerance used by the checks.
- Photographic RGB preservation, transparent clear areas, cached reloads, linked
  coverage, generation cancellation, and failure retention passed the initial
  browser checks without JavaScript errors. The final suite also passed live
  IPMA overlay loading, reconstructed-edge alpha, High-resolution requests/cache
  reuse, and a 390-pixel mobile viewport without horizontal overflow.

These findings demonstrate a functioning still-image experiment. They do not
establish that the visual result matches Meteoblue, that masks preserve every
thin cloud, or that daytime Natural Colour is a viable nighttime solution.
Real iPhone/Safari testing and the external-provider comparison remain open.
