/* Tizandish AI model asset cache — v1 */
'use strict';
const MODEL_CACHE='tizandish-ai-models-v1';
const MODEL_PREFIX='https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/';

self.addEventListener('install',event=>{
 event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('tizandish-ai-models-')&&key!==MODEL_CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});

self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 let url;
 try{url=new URL(request.url)}catch{return}
 if(url.origin!=='https://staticimgly.com'||!url.href.startsWith(MODEL_PREFIX))return;

 event.respondWith((async()=>{
  const cache=await caches.open(MODEL_CACHE);
  const cached=await cache.match(request);
  if(cached)return cached;
  const response=await fetch(request);
  if(response.ok||response.type==='opaque'){
   try{await cache.put(request,response.clone())}catch(error){console.warn('AI model cache write skipped:',error)}
  }
  return response;
 })().catch(async()=>{
  const cache=await caches.open(MODEL_CACHE);
  const cached=await cache.match(request);
  if(cached)return cached;
  return Response.error();
 }));
});
