/* Makktub: scoped worker, no HTML/message caching and no background custom audio. */
'use strict';
const MP_SW_VERSION='push-v1',presence=new Map();let mpQueue=Promise.resolve();
function enqueue(fn){const p=mpQueue.then(fn,fn);mpQueue=p.catch(()=>{});return p}
function openPushDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('makktub-push-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function readState(){const db=await openPushDB();try{return await new Promise((resolve,reject)=>{const t=db.transaction('state','readonly'),r=t.objectStore('state').get('binding');r.onsuccess=()=>resolve(r.result||{uid:'',enabled:false,pushEnabled:false,seen:[]});r.onerror=()=>reject(r.error)})}finally{db.close()}}
async function writeState(s){const db=await openPushDB();try{await new Promise((resolve,reject)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(s,'binding');t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error)})}finally{db.close()}}
function validData(d){return d&&typeof d.uid==='string'&&typeof d.eventId==='string'&&d.eventId.length<=700&&(d.kind==='test'||(d.kind==='message'&&/^[A-Za-z0-9_-]{1,200}$/.test(d.chatId||'')&&/^[A-Za-z0-9_-]{1,200}$/.test(d.messageId||'')))}
function targetHash(d){return d.kind==='test'?'':'#msg/'+encodeURIComponent(d.chatId)+'/'+encodeURIComponent(d.messageId)}
function notificationOptions(s,d,foreground=false){const o={body:d.kind==='test'?'Sinov bildirishnomasi. Makktub Push ishlayapti.':'Yangi xabar. Suhbatni ochish uchun bosing.',icon:new URL('icon-192.webp',self.registration.scope).href,badge:new URL('badge-96.png',self.registration.scope).href,tag:d.kind==='test'?d.eventId:'mk:'+d.uid+':'+d.chatId,renotify:false,silent:foreground||!!s.silent,data:{uid:d.uid,hash:targetHash(d)},timestamp:Date.now()};if(!o.silent&&s.vibrate)o.vibrate=[100,50,100];return o}
async function dispatch(d,source='fcm'){
 if(!validData(d))return {ignored:true};const s=await readState();if(!s.enabled||s.uid!==d.uid||(source==='fcm'&&!s.pushEnabled))return {ignored:true};
 if(d.chatId&&Array.isArray(s.muted)&&s.muted.includes(d.chatId))return {ignored:true};if((s.seen||[]).includes(d.eventId))return {duplicate:true};
 const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const visible=clients.filter(c=>c.url.startsWith(self.registration.scope)&&c.visibilityState==='visible'&&presence.get(c.id)?.uid===d.uid).sort((a,b)=>Number(b.focused)-Number(a.focused));
 s.seen=[...(s.seen||[]),d.eventId].slice(-200);
 if(d.kind!=='test'&&visible.some(c=>presence.get(c.id)?.chatId===d.chatId)){await writeState(s);return {reading:true}};
 if(visible.length){visible[0].postMessage({type:'MP_DELIVER',data:d});if(d.kind==='test'&&s.pushEnabled)await self.registration.showNotification('Makktub',notificationOptions(s,d,true));await writeState(s);return {foreground:true}}
 if(s.pushEnabled)await self.registration.showNotification('Makktub',notificationOptions(s,d));await writeState(s);return {background:true};
}
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('message',e=>{const m=e.data||{},source=e.source;if(!source||!source.url?.startsWith(self.registration.scope))return;const reply=value=>e.ports?.[0]?.postMessage(value);
 if(m.type==='MP_PRESENCE'){presence.set(source.id,{uid:m.uid,chatId:m.chatId||''});return}
 e.waitUntil(enqueue(async()=>{try{
 if(m.type==='MP_BIND'){const b=m.binding;if(!b||typeof b.uid!=='string'||!b.uid||b.uid.length>128)throw Error('Binding noto‘g‘ri');const old=await readState();const s={uid:b.uid,enabled:!!b.enabled,pushEnabled:!!b.pushEnabled,silent:!!b.silent,vibrate:!!b.vibrate,muted:Array.isArray(b.muted)?b.muted.filter(x=>typeof x==='string').slice(0,1000):[],seen:old.uid===b.uid?old.seen||[]:[]};
 if(Array.isArray(m.seen))s.seen=[...new Set([...s.seen,...m.seen.filter(x=>typeof x==='string'&&x.length<=700)])].slice(-200);await writeState(s);presence.set(source.id,{uid:s.uid,chatId:presence.get(source.id)?.uid===s.uid?presence.get(source.id).chatId||'':''});if(old.uid!==s.uid||!s.enabled||!s.pushEnabled){const ns=await self.registration.getNotifications();ns.forEach(n=>n.close())}reply({ok:true});
 }else if(m.type==='MP_UNBIND'){const s=await readState();if(s.uid===m.uid){await writeState({uid:'',enabled:false,pushEnabled:false,seen:[]});const ns=await self.registration.getNotifications();ns.filter(n=>n.data?.uid===m.uid).forEach(n=>n.close())}presence.delete(source.id);reply({ok:true})
 }else if(m.type==='MP_EVENT'){const s=await readState();if(presence.get(source.id)?.uid!==m.data?.uid||s.uid!==m.data?.uid)return reply({ok:true,ignored:true});reply({ok:true,...await dispatch(m.data,'realtime')})
 }else reply({ok:false,error:'Noma’lum so‘rov'});
 }catch(error){reply({ok:false,error:'Bildirishnoma holatini saqlab bo‘lmadi.'})}}));
});
// Install click handling before the FCM SDK installs its own handler.
self.addEventListener('notificationclick',e=>{e.notification.close();e.stopImmediatePropagation();e.waitUntil(enqueue(async()=>{const d=e.notification.data||{},s=await readState();if(!s.enabled||s.uid!==d.uid)return;const hash=typeof d.hash==='string'&&/^#msg\/[A-Za-z0-9_%.-]+\/[A-Za-z0-9_%.-]+$/.test(d.hash)?d.hash:'';const url=new URL(self.registration.scope);url.hash=hash;
 const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});const c=cs.find(c=>c.url.startsWith(self.registration.scope));if(c){await c.focus();c.postMessage({type:'MP_OPEN',uid:d.uid,hash});if(c.navigate)await c.navigate(url.href)}else await self.clients.openWindow(url.href);
 }))});
const MAKKTUB_FIREBASE_CONFIG={
  apiKey:"AIzaSyD9Rj7PiCCGKvXBnHY0N06jHGDwHUypgss",
  authDomain:"sma-messenger.firebaseapp.com",
  projectId:"sma-messenger",
  storageBucket:"sma-messenger.firebasestorage.app",
  messagingSenderId:"81981632966",
  appId:"1:81981632966:web:fa28d95e8af0e0102382c7"
};
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp(MAKKTUB_FIREBASE_CONFIG);
firebase.messaging().onBackgroundMessage(payload=>enqueue(()=>dispatch(payload.data,'fcm')));
