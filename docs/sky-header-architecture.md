# Sky header architecture and PraiasPortugal implementation handoff

Updated 7 November 2026. This is the current behavior specification and the
handoff for a future PraiasPortugal implementation. The standalone source is in
`ipma-radar`; no PraiasPortugal integration has been performed. Sections labelled
as proposed describe work the receiving application must implement.

The header is an illustrative sky driven by solar elevation and Open-Meteo
model-based current conditions. It is not a photograph, a direct station
observation, or a reconstruction of the sky overhead. Radar and satellite
playback keep their own observation times; the header always represents current
conditions at the startup location.

## Startup location and lifecycle

`initSkyTheme()` renders sun-based colours immediately. The existing map
geolocation request resolves the header location once through
`resolveSkyStartupLocation()`. The sky does not make a second GPS request.

- GPS success: use the coordinates obtained at startup.
- GPS denied, unavailable or timed out: use `DEFAULT_LOCATION` from
  `radarMap.js`, matching the map fallback. The badge tooltip identifies this as
  the default map location.
- Panning, zooming and later presses of Current location do not move the banner
  location. Reload the app to choose a new startup location.
- Historical GPS coordinates are not reused as the current physical location.
- Solar colours update each minute; weather refreshes every 15 minutes for the
  fixed startup coordinates.

## Weather service and freshness

`fetchLiveWeather()` requests temperature, total cloud cover, low/mid/high cloud
cover, and WMO weather code from the Open-Meteo Forecast API. `timeformat=unixtime`
provides an unambiguous condition timestamp. Display times use Europe/Lisbon.
The Open-Meteo and CC BY 4.0 links in the map's bottom attribution area credit
the weather provider alongside Leaflet and the map sources. This credit persists
when switching between the standard and GeoColour maps.

Responses store the requested coordinates, condition time and fetch time.
The localStorage cache (`ipmaSkyLiveWeather`) is accepted only for matching
coordinates and valid timestamps. Cache entries from the earlier implementation,
which lack condition time, are ignored.

- Under 15 minutes old: reuse cached conditions.
- 15–60 minutes old: show the last conditions with a **stale** label while
  attempting a refresh.
- 60 minutes old or older: show **Weather unavailable**, hide weather-driven
  clouds and precipitation, and retain the solar colour palette.
- Age is the older of fetch age and condition age; fetching an old model time
  does not make that condition fresh.
- Missing temperature does not prevent valid cloud and condition rendering.
  Missing cloud values do not invent clouds; unknown codes do not imply sunshine.
- Requests time out after 10 seconds. Starting another request aborts the previous
  one; generation and coordinate checks also reject late responses even if the
  transport ignores cancellation.

Open-Meteo describes current conditions as weather-model data, not direct local
observations. See [API documentation](https://open-meteo.com/en/docs).

## How the cloud tiers work — coverage-driven version

Each tier now contains 24 stable procedural SVG patches: eight columns in three
rows. The artwork is generated once in `renderSkyClouds()` and reused. The
percentages control patch count and growth, rather than making one large fixed
cloud drawing progressively more transparent.

| Tier | API input | Model band | Patch artwork | Blur | Layer opacity when present | Drift |
| --- | --- | --- | --- | --- | --- | --- |
| High | `cloud_cover_high` → `high` | 8 km and above | Long curved wisps | 16 | 0.75 | 320 s |
| Mid | `cloud_cover_mid` → `mid` | 3–8 km | Broad overlapping ellipses | 12 | 0.85 | 240 s |
| Low | `cloud_cover_low` → `low` | Up to 3 km, including fog | Rounded puffs and broad bases | 6 | 0.95 | 160 s |

These altitude bands follow [Open-Meteo's variable definitions](https://open-meteo.com/en/docs).
`cloud_cover` → `total` separately selects palette/night visibility; it does not
create missing tiers. The layer opacity values are artistic tuning independent
of the cover percentage, not meteorological conversions.

For patch index `i` from 0 to 23:

```text
amount = clamp(cover, 0, 100) / 100
rank = (i × tier step + tier offset) modulo 24
patch growth = clamp(amount × 24 − rank, 0, 1)
patch opacity = patch growth
patch scale = 0 when growth is zero; otherwise 0.3 + 0.85 × growth
```

The rank permutes activation across the grid instead of filling left to right.
High uses step/offset 7/3, Mid 11/13, Low 5/7; each visits all 24 slots.
Each tier has its own stable placement seed (High 5, Mid 13, Low 23).
Centers have tier-specific horizontal/vertical offsets and fixed width variation;
there is no random regeneration during refresh. Full patches stay at their
tier's normal opacity. Only the boundary patch is partly grown/translucent.
Increasing cover reveals and grows additional patches at stable locations.

- 20% cover: 4 full patches and one patch at 0.8 growth.
- 60% cover: 14 full patches and one patch at 0.4 growth.
- 95% cover: 22 full patches and one patch at 0.8 growth.
- 100% cover: all 24 patches, with overlapping low/mid shapes producing a ceiling.
- Zero or missing cover: no visible patches in that tier.

Growth, patch opacity and whole-tier appearance changes transition over five
seconds. Reduced motion disables those transitions as well as the drift
animations. High wisps remain softer and move more slowly; low shapes are more
defined and overlap as they fill. Movement is decorative, not measured wind.
Drift uses linear timing with different starting phases (negative delays of
High −117 s, Mid −83 s, Low −41 s). Each traversal lasts 320/240/160 seconds.
High and mid initially move right at different rates; low initially moves left.
Each independently reverses at its overscan limit using `alternate`, avoiding a
visible reset. This bounded motion is artistic, not a wind simulation.
Fog uses its condition label and available low-cloud cover; there is no separate
fog simulation.

### Interpretation and limits of the percentages

This is coverage-driven illustrative artwork, not a pixel-calibrated sky map.
The percentage specifies how much of a fixed patch budget is active. Overlap,
overscan beyond the banner, blur, shape size, aspect ratio and lower layers
covering higher layers all affect the final visible fraction. In particular,
80% cover does not guarantee exactly 80% of banner pixels are cloudy.

Keep the three percentages independent; they overlap vertically and must not be
summed or normalized. Do not infer actual species, cloud thickness, wind or
positions from the tier percentages. High-only overcast must not add low clouds.
The previous opacity-only formula (`cover / 100 × tier maximum`) is superseded.

### Blur clipping correction

All three filters retain `x="-20%"` and `width="140%"` and now use
`y="-100%"` and `height="300%"`. The earlier vertical region (`y="-20%"`,
`height="140%"`) cut off the blurred artwork and produced a straight horizontal
edge. Expanding the vertical filter region removed that edge in an isolated
Chrome comparison; the correction was then applied to `index.html`, and the
user confirmed the live result looked good.

Preserve these bounds when copying the SVG definitions. The header still clips
artwork at its outside edge, which is intentional. Check different header
heights and widths in the receiving app, since SVG scaling and blur bounds can
change how edges appear.

## Rain, snow and other conditions

One explicit WMO mapping supplies the text, icon and precipitation effect:

| Codes | Condition | Effect |
| --- | --- | --- |
| 0, 1, 2, 3 | Clear to overcast | No precipitation |
| 45, 48 | Fog | No precipitation |
| 51, 53, 55 | Drizzle | Diagonal rain streaks |
| 56, 57 | Freezing drizzle | Rain streaks; freezing label |
| 61, 63, 65 | Rain | Rain streaks |
| 66, 67 | Freezing rain | Rain streaks; freezing label |
| 71, 73, 75, 77 | Snow / snow grains | Slower falling dots |
| 80, 81, 82 | Rain showers | Rain streaks |
| 85, 86 | Snow showers | Falling dots |
| 95, 97 | Thunderstorm | Rain streaks and storm icon |
| 96, 99 | Thunderstorm with hail | Rain streaks and explicit hail label |
| Unknown / missing | Conditions unavailable | No precipitation |

Rain and snow are mutually exclusive decorative layers. Both are CSS patterns;
no particle engine is involved. Snow is slower and round rather than diagonal.
Light, moderate and heavy codes vary streak spacing/opacity or snow-dot density.
Light: 51, 56, 61, 66, 71, 77, 80, 85. Heavy: 55, 57, 65, 67, 75, 82, 86,
96, 97, 99. Other recognized precipitation codes use moderate presentation.
Drizzle remains subtler than ordinary rain. These are code-based visual classes,
not measured mm/h or snowfall rates. Accumulation, individual hailstones and
lightning are not simulated.
Radar echoes do not control these effects. Precipitation also selects a subdued
palette during broad daylight; other solar phases keep their own palettes.

## Solar colours, moon and stars

`getSolarElevation()` uses approximate declination and equation-of-time formulas.
The palette selects fixed daylight, golden-hour, sunrise/sunset, twilight and
night gradients. Cloud cover can select an overcast variant. These are threshold
changes, not continuous colour interpolation or a physically accurate sky model.

The moon is decorative. Its phase is estimated from a fixed mean lunar cycle;
its fixed header position does not represent local altitude, direction, rise or
set. Its tooltip identifies that limitation. Stars are decorative, with no actual
constellation positioning. They appear only at night with known total cloud
cover below 85%; the illustrative moon is hidden at 92% cover or more. Unknown
weather hides both rather than assuming clear skies.

## Rendering, accessibility and verification

`skyTheme.js` owns weather state, solar calculations and DOM updates. SVG and
CSS in `index.html` and `radar.css` own the drawings and animation. Backgrounds
are decorative and cannot intercept pointer events.

An explicit header `[hidden]` rule handles SVG visibility and overrides badge
layout styles. The View, opacity and status rows remain transparent over the sky;
label colours and text shadows adapt to the light/dark palette. Reduced-motion preferences stop
cloud, rain, snow and star animations. These measures are not a certification of
all WCAG requirements. Filters, gradients and animations have rendering costs;
physical iPhone/Safari performance remains a separate acceptance check.

Run `python3 tests/sky-header-check.py` for deterministic Chrome checks of startup
GPS/fallback, independent cloud tiers, precipitation, visibility, stale/expired
data, request races, cache reuse, reduced motion and mobile layout. Run
`python3 tests/browser-check.py --quick` for the existing radar/GeoColour regression
suite. Both use isolated Chrome profiles and require access to browser assets.

## Source files and dependencies

Paths below are relative to the source `ipma-radar` repository.

| Source | What to carry over or adapt |
| --- | --- |
| `src/js/skyTheme.js` | Weather validation/cache, WMO mapping, solar/phase calculations, palette and patch-growth formulas, rendering and refresh lifecycle |
| `index.html` | `#skyBackground`, cloud SVGs and filter definitions, precipitation layers, moon/stars, `#skyHeading` and weather badge |
| `src/css/radar.css` | Sky, cloud, rain/snow, stars/moon, heading/badge, reduced-motion, hidden and palette-dependent control styles |
| `src/js/app.js` | Example startup ordering: initialize theme, then start the existing location flow |
| `src/js/radarLocation.js` | Example of resolving the startup location on GPS success or fallback |
| `src/js/radarMap.js` | Current default coordinates and independent map attribution entry |
| `tests/sky-header-check.py` | Deterministic browser scenarios to reproduce in the host's test tooling |

The current JavaScript is a classic-script module with globals and fixed DOM
IDs. It expects `DEFAULT_LOCATION` to exist before it loads. Its render function
queries `document`, and its timers live for the page lifetime. It is not yet a
drop-in, reusable component.

PraiasPortugal does not need Leaflet, IPMA radar, GeoColour imagery, satellite
preloading or satellite playback to render the sky. Leaflet is only the current
placement mechanism for weather attribution. Reuse the host's credits area if
there is no map. Do not copy the entire radar stylesheet: it contains global
`select`, page layout and control rules that could affect the host application.

## Proposed PraiasPortugal component contract

### Existing host structure inspected on 7 November 2026

Read-only inspection of `/Users/williamcharash/Documents/GitHub/PraiasPortugal`
confirmed these integration points. No host files were changed.

| Host file | Current role and future sky integration |
| --- | --- |
| `src/js/weatherService.js` | `getCurrentWeather(beach)` requests Open-Meteo using beach coordinates and returns cloudCover/Low/Mid/High, numeric weather/wind, times and hourly data. Adapt this snapshot instead of fetching again. |
| `src/js/weatherFormatter.js` | Uses unit preferences and translations for badge/wind text. Do not parse these strings for animation. |
| `src/js/dataManager.js` | Registers the weather service and coordinates refresh, duplicate-request prevention and freshness. Reuse its lifecycle instead of adding the standalone sky interval/cache. |
| `src/js/conditions.js` | Consumes weather and formatters and invokes the celestial calculation/graphic. Can pass the same snapshot to the sky renderer. |
| `src/js/celestialService.js` | Already calculates host sun/moon state. Evaluate reuse instead of substituting the standalone approximate moon. |

The service already requests all three cloud percentages, but only 10-metre
wind speed/direction/gusts. It does not request winds aloft. Some descriptions
and icons are also produced in the service, so separation from formatting is
useful but not completely strict. This was a source inspection, not a live
validation of every request or host feature.

### Optional future winds aloft — not implemented

Open-Meteo documents hourly wind speed/direction at pressure levels. Candidate
representative levels are 850 hPa (about 1.5 km) for Low, 500 hPa (about 5.6 km)
for Mid and 250 hPa (about 10.4 km) for High. Pressure levels have variable
heights and each cloud band can contain several winds; these would be proxies,
not measured movement of the drawn clouds. See the
[pressure-level documentation](https://open-meteo.com/en/docs#pressure-level-variables).

A future implementation would:

1. Add six speed/direction fields to the service's hourly request, or a separate
   data-manager dataset if model/refresh requirements warrant it. 80/120/180-metre
   winds are not substitutes for mid/high cloud winds.
2. Match the valid hour to current conditions, normalize units and missing
   fields, and return numeric per-tier winds with pressure/time metadata. Handle
   Lisbon daylight-saving offsets explicitly rather than interpreting a local
   clock string as an unambiguous instant.
3. Map wind speeds to restrained apparent motion, accounting for the more distant
   high layer; clamp extremes and retain decorative fallbacks. The formatter
   handles unit preferences and text, while the renderer consumes raw numbers.
4. Define a viewing direction before translating wind bearing to screen travel.
   A banner has no geographic bearing by itself; meteorological wind origin must
   be converted to travel direction. Continuous wind-driven travel would need
   seamless wrapping instead of the current artistic reversal at overscan limits.
5. Test calm/opposing/strong winds, missing levels, time alignment, unit settings,
   refresh transitions, reduced motion and navigation cleanup.

Data retrieval is a modest service extension. Convincing geographically meaningful
motion is more involved because of the viewing convention, apparent-speed mapping
and seamless wrapping. None of that is required for the current simple drift.

### Proposed interface

This is a target interface for the receiving implementation, not an exported
API that exists in this repository:

```js
const sky = createSkyHeader({
  root: headerElement,
  location: {lat, lon, label},
  timeZone: "Europe/Lisbon",
  weatherProvider,  // async ({lat, lon, signal}) => normalized weather
  attributionTarget: creditsElement
});

sky.start();
// On host navigation or component unmount:
sky.destroy();
```

- The host resolves GPS once, or supplies an explicit fallback. Pass the chosen
  startup coordinates to the component; the component must not request GPS.
- Preserve the startup-location policy for the initial integration. A future
  selected-beach policy would instead pass that beach's coordinates explicitly;
  it must not silently substitute the visitor's physical location. Continuous
  location tracking and map-pan tracking are outside this scope.
- Keep weather acquisition separate from rendering. If the host already has a
  compatible weather service, adapt its data instead of making duplicate calls.
- Keep all state and DOM queries inside the component instance. Prefix SVG
  filter/gradient IDs if more than one sky can exist on the page.
- Scope CSS beneath the component root, including dark-mode, hidden and
  reduced-motion selectors. Preserve transparent View/opacity/status rows;
  do not restore the rejected solid horizontal backing bars.
- `start()` must be idempotent. `destroy()` must abort requests, invalidate late
  callbacks, clear minute/weather timers, and release component-owned listeners
  and attribution entries. Repeated navigation must not accumulate timers.
- Cache keys must use the host application's namespace. Preserve coordinate
  matching and timestamp validation; do not reuse arbitrary saved GPS positions.
- Retain discreet, visible provider and licence links in the host credits area.
  The current credits identify Open-Meteo and CC BY 4.0, and the provider link
  tooltip describes model-based conditions and rounded temperature.
- Verify the provider plan for the host's eventual deployment. The free endpoint
  is currently used by this standalone prototype; do not assume its usage terms
  cover a future commercial deployment. See [provider plans](https://open-meteo.com/en/pricing).

### Normalized weather contract

```js
{
  lat: 38.72, lon: -9.14,       // requested coordinates, decimal degrees
  timestamp: 1794052800000,     // fetched-at time, Unix milliseconds
  conditionTime: 1794052800000, // provider valid time, Unix milliseconds
  temperature: 18,             // degrees Celsius, or null; rounded for display
  total: 70, low: 20, mid: 50, high: 80, // independent percentages, or null
  weatherCode: 2               // WMO integer, or null
}
```

The numeric times above are illustrative. The actual provider adapter must
multiply Open-Meteo Unix seconds by 1000 once, retain both times, and preserve
zero as valid data. Missing values are `null`, not fabricated defaults. Clamp
finite cover values to 0–100. Reject invalid/future/expired condition times and
responses for a superseded location. If using an unrounded internal temperature,
round only when building the display text.

### Implementation sequence and acceptance

1. Inspect the host's header, location service, weather data, credits and route
   lifecycle. Create an isolated sky component using the source drawings and
   calculations; supply deterministic fixtures before adding network requests.
2. Adapt the host weather provider, or add the current Open-Meteo request with
   timeout, cancellation, cache and freshness handling. Resolve the startup
   location through the host's existing location flow.
3. Integrate the banner and small credits without changing radar/satellite
   behavior. Keep the weather time separate from any historical map timeline.
4. Validate in the host, then check physical iPhone/Safari appearance and motion.

Acceptance criteria:

- One startup GPS acquisition; correct fallback on denial, absence or timeout.
- Clear fixture: all three tiers vanish. High-only overcast fixture: no invented
  low/mid clouds. Mixed percentages produce the documented patch growth at stable positions.
- Zero, missing and out-of-range cover values are handled without confusing
  missing data with clear weather. Cloud bands are not summed or normalized.
- Rain, freezing rain, snow and snow showers use their documented labels and
  mutually exclusive effects. Unknown codes show no precipitation effect.
- Fresh/stale/expired data and offline startup produce the documented states.
  A late older response cannot replace newer conditions; requests time out.
- Daytime and overcast states hide stars correctly. Missing weather does not
  imply a clear night. Moon artwork remains explicitly illustrative.
- No straight clipping line within the cloud drawing at desktop or mobile
  sizes, including after layout changes. Outer-header clipping remains allowed.
- Controls remain usable, rows transparent, credits readable, and mobile
  headings free of overlaps. Reduced motion freezes every animated sky layer.
- Repeated mount/unmount leaves no active timers, requests or stale DOM writes.
- If the host embeds the radar too, its existing playback, opacity, map-switch
  and attribution checks still pass.

### Copy-paste implementation prompt

```text
Implement the sky header in the PraiasPortugal repository using the current
ipma-radar/docs/sky-header-architecture.md as the behavior specification.
The source repository is /Users/williamcharash/Documents/GitHub/ipma-radar.
Read its src/js/skyTheme.js, the sky markup in index.html, the sky CSS in
src/css/radar.css, the startup wiring in src/js/app.js and radarLocation.js,
the credit in radarMap.js, and tests/sky-header-check.py.

First inspect the receiving repository's instructions and existing header,
location, weather and lifecycle code. Implement an isolated component there;
do not change the source ipma-radar repository. This is a startup-location
banner: reuse the host's location acquisition, pass explicit fallback
coordinates, and keep that location fixed during map navigation. Preserve
independent low/mid/high percentage-to-footprint mapping, transparent control
rows, expanded SVG blur bounds, rain/snow distinction, freshness and cancellation
rules, reduced motion and discreet provider/licence credits. Scope all CSS and
DOM access and provide cleanup on unmount. Do not claim literal cloud-area
coverage, direct station observations or exact local moon visibility.

Use staged fixture-based implementation followed by provider integration, and
complete the handoff's acceptance checks. Report implemented behavior, test
results and remaining physical-device checks. Do not deploy or publish.
```
