# Satellite service comparison

Reviewed 6 November 2026 after the user compared the application with Meteoblue
on iOS. The user reports rapid loading, high detail, roughly two-minute frame
spacing, and a map visible between clouds. Those are useful product goals;
the iOS app's internal implementation and actual acquisition times were not
inspected in this review.

## What Meteoblue documents

Meteoblue combines data from several geostationary satellite providers. It lists
Meteosat/EUMETSAT for Europe, so a different satellite operator is not required
to explain the difference in experience.
[Provider documentation](https://docs.meteoblue.com/en/meteo/data-sources/satellite-and-radar-providers)

Its satellite guidance describes European images updating every five minutes.
That does not verify two-minute acquisitions in the user's installed app.
Animation step spacing and new observations are different quantities; this
review does not establish whether the iOS satellite sequence interpolates.
[Satellite guidance](https://content.meteoblue.com/content/view/full/5941)

The documented external service is a raster tile API with a required API key.
Its public satellite tileset is listed as JPEG. That API description does not
establish how the iOS app renders cloud transparency, nor whether an iOS
subscription includes API access.
[Radar and Satellite Tile API](https://docs.meteoblue.com/en/weather-apis/maps-api/radar-and-satellite-tile-api)

Processed cloud imagery and tile delivery are plausible explanations for the
better experience. Preprocessing, cache/CDN behavior, and the exact rendering
pipeline of the iOS app remain inferences, not verified implementation facts.
No Meteoblue key or subscription credential has been used in this project.

## What the current application requests

Visible, infrared, and Geo Colour are full satellite images, including surface
information. A global opacity slider fades clouds and the underlying scene
together. Cloud-only rendering requires a product or mask that distinguishes
cloud from clear ground/water. Setting WMS `transparent=true` alone does not
perform that classification.

The current application uses public EUMETView WMS images with explicit projection,
bounds, and requested observation times. Arbitrary regional images can involve
server rendering and transfer costs; the project caches them but does not
operate a preprocessed tile service.

## Verified no-key candidates

| Product | Public catalogue cadence | Finding |
| --- | --- | --- |
| `msg_rss:rgb_natural_nrt` | 5 minutes | A rapid-scan natural-colour product is available for investigation. Cadence alone does not establish superior detail or loading speed. |
| `msg_fes:clm` | 15 minutes | Cloud Mask classifies cloud, clear land, clear water, and unprocessed pixels. A sample was retrieved successfully, but its default styling is a classification image rather than a transparent photographic overlay. |

These were verified in live public catalogues during this review:
[rapid scan](https://view.eumetsat.int/geoserver/wms?service=WMS&request=GetCapabilities&version=1.3.0&namespace=msg_rss),
[Cloud Mask](https://view.eumetsat.int/geoserver/wms?service=WMS&request=GetCapabilities&version=1.3.0&namespace=msg_fes).

The Cloud Mask sample requested 6 November 2026 at 10:45 UTC returned a valid
RGBA PNG. With `transparent=true`, clear regions still appeared as coloured
classes. A cloud-only layer would need verified class semantics and rendering,
not another approximate colour threshold on ordinary visible/IR imagery.

## Next service experiment

Keep the working radar and existing sources as the reference. In an isolated
prototype, test a genuine cloud-only layer or compatible imagery/mask pair with
matched observation times, identical projected pixel grids, explicit clear-area
alpha, and verified geographic registration. Measure first image, zoom, and
history latency independently. Compare five-minute rapid scan with the present
products using actual returned observations, not denser invented timestamps.

Neither candidate has replaced a production source. Cloud-only photographic
transparency, two-minute observations, a complete detailed-animation preload,
and a Meteoblue-equivalent delivery service are not implemented. Complete
High-resolution sequence staging was subsequently implemented below.


## Follow-up: free access and cloud-only rendering

Reviewed during the approved playback/coverage/resolution work on 6 November
2026. The user now accepts a free API key if limited noncommercial distribution
is permitted. This changes the service-selection constraint; no key is needed
for the current WMS sources and none has been added.

**RealEarth:** its official terms explicitly allow public integration in websites
and mobile apps, with attribution `Source: SSEC RealEarth, UW-Madison`. Its access
page describes free composites up to 512 × 512 and watermark thresholds of 500
megapixels per rolling 24 hours (higher limits for registered users). These are
service limits, not a guarantee of low latency or unlimited distribution.
[Terms](https://www.ssec.wisc.edu/realearth/terms-of-use/),
[access limits](https://www.ssec.wisc.edu/realearth/realearth-pro/),
[product catalogue](https://realearth.ssec.wisc.edu/products/).

The public catalogue was inspected for global visible/IR imagery. Available
full-scene imagery is not evidence of clear-sky alpha: a visible product's
transparent *night* region is different from transparent clear ground/water.
A suitable observed, cloud-only photographic Portugal sequence was not verified.
RealEarth has therefore not been substituted for EUMETView.

**EUMETSAT Cloud Mask (`msg_fes:clm`):** the provider's product guide distinguishes
clear water, clear land, cloud, and unprocessed regions. Its published example
renders cloud white, land green, and water blue. This is a promising source for
a categorical cloud-only overlay with clear-area alpha, rather than guessing
clouds from ordinary visible/IR colours. It is not photographic cloud texture.
The live catalogue advertises 15-minute observations. A small PNG sample and
official legend were retrieved, but no production conversion is included.
[Cloud Mask guide](https://user.eumetsat.int/s3/eup-strapi-media/pdf_clm_pg_6b00d53e6b.pdf),
[product catalogue](https://user.eumetsat.int/catalogue/EO:EUM:DAT:MSG:CLM).

The current EUMETSAT policy permits redistribution of Core data under CC BY 4.0;
this review did not establish this specific product's current Core designation.
Do not treat access to its WMS image as sufficient verification of redistribution
terms for a new derived cloud product.
[Data policy](https://www-cdn.eumetsat.int/files/2024-07/45173%20-%20Data%20Policy%281419774%20V1%29.pdf).

A Meteoblue iOS subscription has not been treated as an API entitlement. No free
satellite API tier with the requested photographic transparency, Portugal
history, and redistribution rights was verified. That remains a separate
provider/prototype investigation, not a completed application feature.

The approved **Low / High** comparison is now implemented for existing products:
both sizes are cached; High waits for a complete matching set and switches at a
playback boundary. This improves consistency and comparison, not the native
satellite cadence or provider rendering latency.
