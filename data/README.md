# Map outlines

`map-features.geojson` bundles Natural Earth 1:50m coastlines and country land
boundaries for longitude -40 to 15, latitude 25 to 55. It covers Portugal, nearby
Atlantic islands, western Europe, and northwestern Africa. These are generalized
cartographic outlines, not a high-precision shoreline survey.

Source: [Natural Earth](https://www.naturalearthdata.com/), public domain under
its [terms of use](https://www.naturalearthdata.com/about/terms-of-use/).
Downloaded 6 November 2026 from source revision
`ca96624a56bd078437bca8184e78163e5039ad19`:

- [Coastline GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_coastline.geojson)
- [Country boundaries GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_50m_admin_0_boundary_lines_land.geojson)

Line segments were clipped to the regional rectangle, split at its edges, and
rounded to five decimal places. Properties were reduced to `kind` (`coastline`
or `border`). No line was added around the clipping rectangle. Coordinates
remain GeoJSON longitude/latitude; Leaflet projects them into the map CRS.
The data is loaded locally and drawn above satellite and radar at all opacities.

## Cloud-lab place names and roads

The separate cloud lab also uses `cloud-lab-places.geojson` (479 places, about
77 KB) and `cloud-lab-roads.geojson` (1,992 major/secondary road features, about
1.2 MB). These are regional extracts of Natural Earth's public-domain 1:10m
populated places and roads, using the same pinned revision and geographic clip
as the outlines above:

- [Populated places source](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_populated_places.geojson)
- [Road source](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_roads.geojson)

Names, population priority, capital status and minimum display zoom are retained
for places. Roads retain type, display zoom and geographic bounds; only major
and secondary highways are included. Road segments are clipped at the regional
rectangle without adding an edge around it. Coordinates are rounded to five
decimal places. These generalized data provide weather-map context, not current
street-level navigation or a complete town catalogue.

Regenerate using `python3 scripts/build-cloud-lab-map-data.py`. The script downloads
pinned raw source files to a temporary source cache if missing; `--source-dir`
can point to an existing local download directory. The lab renders these vectors
above the satellite/radar panes, with independent controls and place-label
collision suppression. No hosted labels service or API key is needed.
