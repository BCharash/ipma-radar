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

## How the cloud tiers work

Three SVG drawings in `index.html` are layered behind the controls. The shapes
are fixed artwork. They do not identify actual cloud species or positions from
the API. Separate model percentages control how strongly each drawing appears.
The model altitude bands below follow Open-Meteo's variable definitions.

| Tier | Model band | Artwork | SVG blur | Maximum opacity | Drift cycle |
| --- | --- | --- | --- | --- | --- |
| High | 8 km and above | Long curved strokes, suggesting wisps | 16 | 0.75 | 320 seconds |
| Mid | 3–8 km | Overlapping wide ellipses, suggesting sheets | 12 | 0.85 | 240 seconds |
| Low | Up to 3 km, including fog | Circles and ellipses, suggesting rounded puffs | 6 | 0.95 | 160 seconds |

The input path is explicit:

| API field | Normalized state | Drawing | Applied opacity |
| --- | --- | --- | --- |
| `cloud_cover_low` | `liveWeatherData.low` | `#skyLowClouds` | `low / 100 × 0.95` |
| `cloud_cover_mid` | `liveWeatherData.mid` | `#skyMidClouds` | `mid / 100 × 0.85` |
| `cloud_cover_high` | `liveWeatherData.high` | `#skyHighClouds` | `high / 100 × 0.75` |
| `cloud_cover` | `liveWeatherData.total` | Palette and night visibility | Does not supply tier opacity |

For each tier:

```text
opacity = clamp(model cloud cover, 0, 100) / 100 × maximum opacity
```

For example, 80% high cover and 0% low/mid cover gives high opacity 0.60 and
zero opacity for the other drawings. No low cloud is added just because total
cloud cover is high. At 0% cover, that tier disappears completely.

Opacity is a visual proxy for amount: 80% cloud cover does not mean exactly 80%
of the header's pixels are covered. The drawings keep the same footprint.
Likewise, the three percentages must not be added together: cloud layers may
overlap vertically. Total cover is a separate input used for sky palette and
star visibility, not to manufacture missing altitude layers.

High clouds use the softest blur and slowest drift. Low clouds have more defined
edges and faster drift. The speed and direction are decorative CSS choices,
not measured wind at those heights. Colours change with the solar palette;
cloud shape and species do not change in response to weather codes. Fog uses
its condition label and available low-cloud cover; there is no separate fog
simulation.

### Interpretation and limits of the percentages

We correctly preserve each model percentage as an independent input, clamp it
to 0–100, and scale that tier's visibility proportionally. The maximum opacity
values are artistic tuning, not meteorological conversions. For low=20,
mid=50 and high=80, the resulting opacities are 0.19, 0.425 and 0.60. SVG
attributes are rounded to two decimals when applied to the drawing.

This is an amount-responsive illustration rather than a quantitative coverage
map. A large percentage makes an existing shape more opaque; it does not spread
cloud over a corresponding fraction of the banner. Lower drawings are painted
over higher drawings, so overlap also affects the final visible result. Do not
describe the output as exact cloud fraction or observed cloud structure.

An area-based representation would require a separate design: change cloud
footprints or distribution according to cover, then validate overlap between
tiers. That is not implemented or required for this handoff. Preserve the
current opacity behavior unless a later task explicitly changes that design.

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
Intensity, accumulation, individual hailstones and lightning are not simulated.
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
| `src/js/skyTheme.js` | Weather validation/cache, WMO mapping, solar/phase calculations, palette and opacity formulas, rendering and refresh lifecycle |
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
  low/mid clouds. Mixed percentages produce the documented scaled opacities.
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
independent low/mid/high percentage-to-opacity mapping, transparent control
rows, expanded SVG blur bounds, rain/snow distinction, freshness and cancellation
rules, reduced motion and discreet provider/licence credits. Scope all CSS and
DOM access and provide cleanup on unmount. Do not claim literal cloud-area
coverage, direct station observations or exact local moon visibility.

Use staged fixture-based implementation followed by provider integration, and
complete the handoff's acceptance checks. Report implemented behavior, test
results and remaining physical-device checks. Do not deploy or publish.
```
