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
