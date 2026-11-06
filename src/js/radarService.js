"use strict";

/*
 * radarService.js
 * Discover timestamped IPMA frames and preload/cache their images.
 * buildFrameList reads the controller loadGeneration to reject superseded loads.
 */

const RADAR_BASE_URL =
  "https://www.ipma.pt/resources.www/transf/radar/por/";

const IPMA_FRAME_MINUTES = 5;

const imageCache = new Map();


function radarFilename(date){

  const yyyy =
    date.getUTCFullYear();

  const mm =
    String(
      date.getUTCMonth()+1
    ).padStart(2,"0");

  const dd =
    String(
      date.getUTCDate()
    ).padStart(2,"0");

  const hh =
    String(
      date.getUTCHours()
    ).padStart(2,"0");

  const min =
    String(
      date.getUTCMinutes()
    ).padStart(2,"0");

  return (
    "pcr-" +
    yyyy +
    "-" +
    mm +
    "-" +
    dd +
    "T" +
    hh +
    min +
    ".png"
  );
}


function radarURL(date){
  return (
    RADAR_BASE_URL +
    radarFilename(date)
  );
}


function floorToFiveMinutes(date){

  const d =
    new Date(date);

  d.setUTCSeconds(
    0,
    0
  );

  d.setUTCMinutes(
    Math.floor(
      d.getUTCMinutes() /
      IPMA_FRAME_MINUTES
    ) *
    IPMA_FRAME_MINUTES
  );

  return d;
}


function testImage(url){

  return new Promise(
    resolve => {

      const img =
        new Image();

      img.onload =
        () => resolve(true);

      img.onerror =
        () => resolve(false);

      img.src = url;
    }
  );
}


async function findLatestFrame(){

  let candidate =
    floorToFiveMinutes(
      new Date()
    );

  for(
    let i=0;
    i<=6;
    i++
  ){

    const url =
      radarURL(candidate);

    if(imageCache.has(url)){
      return candidate;
    }

    if(await testImage(url)){
      return candidate;
    }

    candidate =
      new Date(
        candidate.getTime() -
        IPMA_FRAME_MINUTES *
        60 *
        1000
      );
  }

  return null;
}


async function buildFrameList(
  historyHours,
  intervalMinutes,
  generation
){

  const newest =
    await findLatestFrame();

  if(
    !newest ||
    generation !== loadGeneration
  ){
    return [];
  }

  const frameCount =
    Math.floor(
      historyHours *
      60 /
      intervalMinutes
    );

  const frames = [];

  for(
    let i=frameCount;
    i>=0;
    i--
  ){

    if(
      generation !==
      loadGeneration
    ){
      return [];
    }

    const date =
      new Date(
        newest.getTime() -
        i *
        intervalMinutes *
        60 *
        1000
      );

    frames.push({
      date,
      url:radarURL(date),
      loaded:false
    });
  }

  return frames;
}


function preloadFrame(frame){

  if(imageCache.has(frame.url)){

    frame.image =
      imageCache.get(frame.url);

    frame.loaded = true;

    return Promise.resolve(
      frame.image
    );
  }

  return new Promise(
    resolve => {

      const img =
        new Image();

      img.decoding = "sync";

      img.onload =
        async () => {

          try{
            if(img.decode){
              await img.decode();
            }
          }
          catch(e){}

          imageCache.set(
            frame.url,
            img
          );

          frame.image = img;
          frame.loaded = true;

          resolve(img);
        };

      img.onerror =
        () => {

          frame.loaded = false;

          resolve(null);
        };

      img.src = frame.url;
    }
  );
}
