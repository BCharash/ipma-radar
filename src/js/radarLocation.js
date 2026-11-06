"use strict";

/*
 * radarLocation.js
 * Own the current-location control, geolocation requests, and accuracy markers.
 */

let locationMarker = null;

let locationAccuracy = null;


function addLocationControl(){

  const LocationControl =
    L.Control.extend({

      options:{
        position:"topright"
      },

      onAdd:function(){

        const button =
          L.DomUtil.create(
            "button",
            "location-control"
          );

        button.type = "button";
        button.title =
          "Current location";

        button.setAttribute(
          "aria-label",
          "Current location"
        );

        button.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="3"></circle>' +
          '<line x1="12" y1="2" x2="12" y2="6"></line>' +
          '<line x1="12" y1="18" x2="12" y2="22"></line>' +
          '<line x1="2" y1="12" x2="6" y2="12"></line>' +
          '<line x1="18" y1="12" x2="22" y2="12"></line>' +
          '</svg>';

        L.DomEvent.disableClickPropagation(
          button
        );

        L.DomEvent.on(
          button,
          "click",
          () =>
            useCurrentLocation({
              silent:false
            })
        );

        return button;
      }
    });

  map.addControl(
    new LocationControl()
  );

  addRadarRangeControl();
}


function useCurrentLocation(
  options={}
){

  const silent =
    options.silent === true;

  if(!navigator.geolocation){

    if(!silent){
      alert(
        "Geolocation is not available in this browser."
      );
    }

    return;
  }

  if(!silent){
    showStatus(
      "Finding your location…"
    );
  }

  navigator.geolocation.getCurrentPosition(

    position => {

      const {
        latitude:lat,
        longitude:lon,
        accuracy
      } = position.coords;

      if(locationMarker){
        map.removeLayer(
          locationMarker
        );
      }

      if(locationAccuracy){
        map.removeLayer(
          locationAccuracy
        );
      }

      locationAccuracy =
        L.circle(
          [lat,lon],
          {
            radius:accuracy,
            weight:1,
            fillOpacity:.08
          }
        ).addTo(map);

      locationMarker =
        L.circleMarker(
          [lat,lon],
          {
            radius:6,
            weight:2,
            fillOpacity:.9
          }
        ).addTo(map);

      map.setView(
        [lat,lon],
        Math.max(
          map.getZoom(),
          8
        ),
        {
          animate:false
        }
      );

      if(!silent){
        hideStatus();
      }
    },

    () => {

      if(!silent){

        hideStatus();

        alert(
          "Unable to determine your location."
        );
      }
    },

    {
      enableHighAccuracy:true,
      timeout:10000,
      maximumAge:300000
    }
  );
}
