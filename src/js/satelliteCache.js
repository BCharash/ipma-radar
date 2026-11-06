"use strict";

/* Timestamped WMS images are immutable cache keys. Keep compressed images,
 * not DOM elements: an image element cannot belong to two overlays at once.
 * Cache Storage survives reloads when available; memory-only remains usable.
 */
const SATELLITE_CACHE_NAME = "ipma-satellite-images-v1";
const SATELLITE_MEMORY_LIMIT = 16*1024*1024;
const SATELLITE_DISK_LIMIT = 48*1024*1024;
const SATELLITE_DISK_ENTRIES = 96;
const satelliteImageCache = new Map();
const satelliteFailedUntil = new Map();
const satelliteCacheStats = {memoryHits:0, diskHits:0, networkLoads:0, failureSkips:0};
let satelliteMemoryBytes = 0;
let satelliteCacheStorage = null;
let satelliteCacheWrites = Promise.resolve();

function openSatelliteCache(){
  if(!satelliteCacheStorage){
    satelliteCacheStorage = (async () => {
      try { return window.caches ? await caches.open(SATELLITE_CACHE_NAME) : null; }
      catch(error) { return null; }
    })();
  }
  return satelliteCacheStorage;
}

function rememberSatelliteBlob(url, blob){
  const previous = satelliteImageCache.get(url);
  if(previous){
    satelliteImageCache.delete(url);
    satelliteImageCache.set(url, previous);
    return previous.objectURL;
  }
  const entry = {objectURL:URL.createObjectURL(blob), bytes:blob.size};
  satelliteImageCache.set(url, entry);
  satelliteMemoryBytes += entry.bytes;
  while(satelliteMemoryBytes > SATELLITE_MEMORY_LIMIT && satelliteImageCache.size > 1){
    const oldest = satelliteImageCache.keys().next().value;
    const removed = satelliteImageCache.get(oldest);
    satelliteImageCache.delete(oldest);
    satelliteMemoryBytes -= removed.bytes;
    URL.revokeObjectURL(removed.objectURL);
  }
  return entry.objectURL;
}

function persistSatelliteBlob(url, blob){
  satelliteCacheWrites = satelliteCacheWrites.then(async () => {
    const cache = await openSatelliteCache();
    if(!cache) return;
    await cache.put(url, new Response(blob, {headers:{
      "Content-Type":"image/png", "X-IPMA-Radar-Bytes":String(blob.size)
    }}));
    const keys = await cache.keys();
    let bytes = 0;
    const sizes = [];
    for(const key of keys){
      const response = await cache.match(key);
      const size = Number(response && response.headers.get("X-IPMA-Radar-Bytes")) || 0;
      sizes.push(size);
      bytes += size;
    }
    let removed = 0;
    while(keys.length-removed > SATELLITE_DISK_ENTRIES || bytes > SATELLITE_DISK_LIMIT){
      await cache.delete(keys[removed]);
      bytes -= sizes[removed++];
    }
  }).catch(() => {
    // Quota/private-mode failures must not prevent display or memory caching.
  });
}

async function satelliteBlobURL(url, signal){
  if(signal.aborted) throw new DOMException("Aborted", "AbortError");
  const memory = satelliteImageCache.get(url);
  if(memory){
    satelliteImageCache.delete(url);
    satelliteImageCache.set(url, memory);
    satelliteCacheStats.memoryHits++;
    return memory.objectURL;
  }
  const cache = await openSatelliteCache();
  let stored = null;
  try { stored = cache && await cache.match(url); } catch(error) {}
  if(signal.aborted) throw new DOMException("Aborted", "AbortError");
  if(stored){
    const blob = await stored.blob();
    if(signal.aborted) throw new DOMException("Aborted", "AbortError");
    satelliteCacheStats.diskHits++;
    return rememberSatelliteBlob(url, blob);
  }
  satelliteCacheStats.networkLoads++;
  const response = await fetch(url, {signal, credentials:"omit"});
  if(!response.ok || !response.headers.get("Content-Type")?.includes("image/png")){
    throw new Error("Satellite image HTTP " + response.status);
  }
  const blob = await response.blob();
  if(signal.aborted) throw new DOMException("Aborted", "AbortError");
  const objectURL = rememberSatelliteBlob(url, blob);
  persistSatelliteBlob(url, blob);
  return objectURL;
}

function loadSatelliteImage(url, signal){
  if(Date.now() < (satelliteFailedUntil.get(url) || 0)){
    satelliteCacheStats.failureSkips++;
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const request = new AbortController();
    const image = new Image();
    image.decoding = "async";
    let finished = false;
    const finish = value => {
      if(finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      image.onload = image.onerror = null;
      if(!value && !signal.aborted){
        satelliteFailedUntil.set(url, Date.now()+45000);
        if(satelliteFailedUntil.size > 128) satelliteFailedUntil.delete(satelliteFailedUntil.keys().next().value);
      }
      else if(value){
        satelliteFailedUntil.delete(url);
      }
      resolve(value);
    };
    const abort = () => { request.abort(); finish(null); image.removeAttribute("src"); };
    const timeout = setTimeout(abort, 20000);
    signal.addEventListener("abort", abort, {once:true});
    image.onload = async () => {
      try { if(image.decode) await image.decode(); } catch(error) { finish(null); return; }
      finish(signal.aborted ? null : image);
    };
    image.onerror = () => finish(null);
    if(signal.aborted){ abort(); return; }
    satelliteBlobURL(url, request.signal).then(objectURL => {
      if(!finished) image.src = objectURL;
    }).catch(() => finish(null));
  });
}
