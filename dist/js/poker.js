// SB Racing Poker Run
const SUITS=['S','H','D','C'],RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL=Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));
const POKER_GUEST_KEY='sbr_poker_guest';

function fullDeck(){const d=[];for(const r of RANKS)for(const s of SUITS)d.push(r+s);return d}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function parseCard(c){return{code:c,rank:c.slice(0,-1),suit:c.slice(-1),val:RANK_VAL[c.slice(0,-1)]}}
function cardLabel(c){const p=parseCard(c);return p.rank+p.suit}

function combinations(arr, k) {
  const out = [];
  function rec(start, picked) {
    if (picked.length === k) { out.push(picked.slice()); return; }
    for (let i = start; i < arr.length; i++) {
      picked.push(arr[i]);
      rec(i + 1, picked);
      picked.pop();
    }
  }
  rec(0, []);
  return out;
}

function scoreFive(codes) {
  const parsed = codes.map(parseCard);
  const vals = parsed.map(p => p.val).sort((a, b) => b - a);
  const suits = parsed.map(p => p.suit);
  const flush = codes.length >= 5 && suits.every(s => s === suits[0]);

  const uniq = [...new Set(vals)].sort((a, b) => b - a);
  const aceLow = uniq.includes(14) && [5, 4, 3, 2].every(v => uniq.includes(v));
  let straight = false;
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) {
      straight = true;
      straightHigh = uniq[0];
    } else if (aceLow) {
      straight = true;
      straightHigh = 5;
    }
  }

  const counts = {};
  vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const by = Object.entries(counts)
    .map(([v, c]) => ({ val: +v, count: c }))
    .sort((a, b) => b.count - a.count || b.val - a.val);

  const kickers = by.flatMap(b => Array(b.count).fill(b.val));

  if (straight && flush) return { rank: 8, name: straightHigh === 14 ? 'Royal Flush' : 'Straight Flush', tiebreak: [straightHigh] };
  if (by[0].count === 4) return { rank: 7, name: 'Four of a Kind', tiebreak: [by[0].val, by[1] ? by[1].val : 0] };
  if (by[0].count === 3 && by[1] && by[1].count === 2) return { rank: 6, name: 'Full House', tiebreak: [by[0].val, by[1].val] };
  if (flush) return { rank: 5, name: 'Flush', tiebreak: vals };
  if (straight) return { rank: 4, name: 'Straight', tiebreak: [straightHigh] };
  if (by[0].count === 3) return { rank: 3, name: 'Three of a Kind', tiebreak: kickers };
  if (by[0].count === 2 && by[1] && by[1].count === 2) return { rank: 2, name: 'Two Pair', tiebreak: [by[0].val, by[1].val, by[2] ? by[2].val : 0] };
  if (by[0].count === 2) return { rank: 1, name: 'One Pair', tiebreak: kickers };
  return { rank: 0, name: 'High Card', tiebreak: vals };
}

function evaluateHand(codes) {
  if (!codes || !codes.length) return { rank: 0, name: 'No cards', tiebreak: [] };
  if (codes.length <= 5) return scoreFive(codes);
  let best = { rank: -1, name: 'No cards', tiebreak: [] };
  for (const five of combinations(codes, 5)) {
    const s = scoreFive(five);
    if (compareScores(s, best) > 0) best = s;
  }
  return best;
}

function compareScores(a,b){if(a.rank!==b.rank)return a.rank-b.rank;for(let i=0;i<5;i++){const d=(a.tiebreak[i]||0)-(b.tiebreak[i]||0);if(d)return d}return 0}
function escapeHtml(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):''}
const SUIT_GLYPH = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };

function cardHtml(code, opts) {
  opts = opts || {};
  var large = !!opts.large;
  var flipped = opts.flipped === true;
  var deal = !!opts.deal;
  var p = parseCard(code);
  var red = (p.suit === 'H' || p.suit === 'D');
  var glyph = SUIT_GLYPH[p.suit] || p.suit;
  var cls = 'poker-card' + (large ? ' lg' : '') + (flipped ? ' flipped' : '') + (deal ? ' deal' : '');
  return (
    '<div class="' + cls + '" data-card="' + code + '">' +
      '<div class="poker-card-inner">' +
        '<div class="poker-card-face poker-card-back"></div>' +
        '<div class="poker-card-face poker-card-front' + (red ? ' red' : '') + '">' +
          '<div class="poker-card-corner"><span>' + p.rank + '</span><span class="suit">' + glyph + '</span></div>' +
          '<div class="poker-card-center">' + glyph + '</div>' +
          '<div class="poker-card-corner bl"><span>' + p.rank + '</span><span class="suit">' + glyph + '</span></div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function renderCardFaceOnly(code) {
  return cardHtml(code, { large: false, flipped: true, deal: false });
}
function cardBackHtml() {
  return (
    '<div class="poker-card">' +
      '<div class="poker-card-inner">' +
        '<div class="poker-card-face poker-card-back"></div>' +
      '</div>' +
    '</div>'
  );
}

function animateCardReveal(container, code) {
  if (!container) return Promise.resolve();
  container.innerHTML = cardHtml(code, { large: true, flipped: false, deal: true, tapHint: true });
  var el = container.querySelector('.poker-card');
  if (!el) return Promise.resolve();
  return new Promise(function (resolve) {
    var done = false;
    function flip() {
      if (done) return;
      done = true;
      el.classList.add('flipped');
      el.classList.remove('cursor-pointer');
      var back = el.querySelector('.poker-card-back');
      if (back) back.classList.remove('hint');
      el.removeEventListener('click', flip);
      setTimeout(resolve, 700);
    }
    el.addEventListener('click', flip);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Tap to reveal your card');
  });
}

let pokerEventId=null,pokerToken=null,pokerLocation=null,currentEntry=null,pokerLockedMember=false;
let pokerPickupMode='both',pokerRadiusFt=20,pokerAllLocations=[],pokerGpsWatch=null,pokerLastGps=null,pokerWantGeo=false,pokerEventRow=null,pokerResultsOpen=false;

function parsePokerPickupMeta(desc){
  var m=String(desc||'').match(/\[\[poker:(both|qr|geo):(\d+)\]\]/i);
  return{
    mode:m?String(m[1]).toLowerCase():'both',
    radiusFt:m?Math.max(10,parseInt(m[2],10)||20):20
  };
}
function parseExpireMeta(desc){
  var m=String(desc||'').match(/\[\[expire:(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})(?::\d{2})?\]\]/i);
  if(!m)return 0;
  var hh=m[2].length===4?'0'+m[2]:m[2];
  var d=new Date(m[1]+'T'+hh+':00');
  return isNaN(d.getTime())?0:d.getTime();
}
function pokerEventCompleted(ev){
  var exp=parseExpireMeta(ev&&ev.description);
  if(exp)return Date.now()>exp;
  if(!ev||!ev.event_date)return false;
  var dateStr=String(ev.event_date).slice(0,10);
  var timeStr='12:00:00';
  if(ev.event_time){
    var tm=String(ev.event_time);
    var m=tm.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(m)timeStr=(m[1].length===1?'0'+m[1]:m[1])+':'+m[2]+':'+(m[3]||'00');
  }
  var d=new Date(dateStr+'T'+timeStr);
  if(isNaN(d.getTime()))d=new Date(dateStr+'T12:00:00');
  if(isNaN(d.getTime()))return false;
  return Date.now()>(d.getTime()+24*60*60*1000);
}
function haversineFeet(aLat,aLng,bLat,bLng){
  var R=20902231; // earth radius in feet
  var toR=Math.PI/180;
  var dLat=(bLat-aLat)*toR,dLng=(bLng-aLng)*toR;
  var s=Math.sin(dLat/2),s2=Math.sin(dLng/2);
  var h=s*s+Math.cos(aLat*toR)*Math.cos(bLat*toR)*s2*s2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function locCoords(loc){
  if(!loc)return null;
  if(loc.lat!=null&&loc.lng!=null&&!isNaN(Number(loc.lat))&&!isNaN(Number(loc.lng)))
    return{lat:Number(loc.lat),lng:Number(loc.lng)};
  var m=String(loc.description||'').match(/📍\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if(m)return{lat:parseFloat(m[1]),lng:parseFloat(m[2])};
  return null;
}

function getQuery(){const q=new URLSearchParams(location.search);return{eventId:q.get('e')||q.get('event'),token:q.get('t')||q.get('token'),geo:q.get('geo'),board:q.get('board')}}
function showPokerMsg(m){const el=document.getElementById('poker-status');if(!el)return;el.textContent=m||'';el.classList.toggle('hidden',!m)}

async function getPokerUser(){
  if(typeof getCurrentUser==='function'){
    try{const u=await getCurrentUser();if(u)return u;}catch(e){}
  }
  if(!window.sb||!window.sb.auth)return null;
  try{
    const{data}=await window.sb.auth.getSession();
    return(data&&data.session&&data.session.user)||null;
  }catch(e){return null;}
}

async function getLoggedInDisplayName(user){
  if(!user)return'';
  if(typeof getProfile==='function'){
    try{
      const p=await getProfile(user.id);
      if(p&&p.full_name)return String(p.full_name).trim();
    }catch(e){}
  }
  try{
    const{data}=await window.sb.from('profiles').select('full_name').eq('id',user.id).maybeSingle();
    if(data&&data.full_name)return String(data.full_name).trim();
  }catch(e){}
  const meta=user.user_metadata||{};
  return String(meta.full_name||meta.name||(user.email?user.email.split('@')[0]:'')||'').trim();
}

function loadGuestIdentity(){
  try{
    const raw=localStorage.getItem(POKER_GUEST_KEY);
    if(raw){
      const obj=JSON.parse(raw);
      if(obj&&obj.name)return obj;
    }
  }catch(e){}
  return null;
}

function saveGuestIdentity(name,email){
  const prev=loadGuestIdentity()||{};
  const obj={
    name:String(name||prev.name||'').trim(),
    email:String(email||prev.email||'').trim(),
    guestId:prev.guestId||(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():('g'+Date.now()))
  };
  try{localStorage.setItem(POKER_GUEST_KEY,JSON.stringify(obj));}catch(e){}
  return obj;
}

function clearGuestIdentity(){
  try{localStorage.removeItem(POKER_GUEST_KEY);}catch(e){}
}

function showJoinedState(name,opts){
  opts=opts||{};
  const form=document.getElementById('poker-join-form');
  const banner=document.getElementById('poker-playing-as');
  const bannerName=document.getElementById('poker-playing-as-name');
  const changeBtn=document.getElementById('poker-change-rider');
  const joined=document.getElementById('poker-joined');
  if(bannerName)bannerName.textContent=name||'Rider';
  if(banner)banner.classList.remove('hidden');
  if(changeBtn){
    changeBtn.classList.toggle('hidden',!!opts.locked);
    changeBtn.disabled=!!opts.locked;
  }
  if(form)form.classList.add('hidden');
  if(joined)joined.classList.remove('hidden');
}

function showJoinForm(prefill){
  const form=document.getElementById('poker-join-form');
  const banner=document.getElementById('poker-playing-as');
  if(banner)banner.classList.add('hidden');
  if(form)form.classList.remove('hidden');
  if(prefill){
    const n=document.getElementById('poker-rider-name');
    const e=document.getElementById('poker-rider-email');
    if(n&&prefill.name)n.value=prefill.name;
    if(e&&prefill.email)e.value=prefill.email;
  }
}

window.changePokerRider=function(){
  if(pokerLockedMember){
    showToast('Logged-in members play under their account name',true);
    return;
  }
  currentEntry=null;
  try{if(pokerEventId)localStorage.removeItem('poker_entry_'+pokerEventId);}catch(e){}
  const guest=loadGuestIdentity()||{};
  showJoinForm({name:guest.name||'',email:guest.email||''});
};

async function initPokerPage(){
  const q=getQuery();
  pokerEventId=q.eventId?parseInt(q.eventId,10):null;
  pokerToken=q.token;
  pokerWantGeo=q.geo==='1'||q.geo==='true';
  var boardOnly=q.board==='1'||q.board==='true';
  if(!window.sb){setTimeout(initPokerPage,150);return}
  if(pokerEventId&&boardOnly)await loadLeaderboardOnly();
  else if(pokerEventId&&pokerToken)await loadStopMode();
  else if(pokerEventId)await loadEventPokerHub();
  else showPokerMsg('Scan a checkpoint QR code or open an event to check in by GPS.');
}

async function loadStopMode(){
  showPokerMsg('Loading...');
  try{
    const{data:loc,error}=await window.sb.from('poker_locations').select('*').eq('qr_token',pokerToken).eq('event_id',pokerEventId).maybeSingle();
    if(error)throw error;
    if(!loc||!loc.is_active){showPokerMsg('Invalid checkpoint QR.');return}
    pokerLocation=loc;
    const{data:ev}=await window.sb.from('events').select('*').eq('id',pokerEventId).single();
    applyPokerEventSettings(ev);
    if(pokerPickupMode==='geo'){
      showPokerMsg('This event uses GPS check-in, not QR. Opening nearby stops…');
      await loadEventPokerHub();
      return;
    }
    document.getElementById('poker-stop-panel').classList.remove('hidden');
    document.getElementById('poker-stop-name').textContent=loc.name;
    document.getElementById('poker-event-name').textContent=(ev&&ev.title)||'Poker Run';
    document.getElementById('poker-stop-desc').textContent=loc.description||'Draw your card for this checkpoint.';
    await tryResumeEntry();
    await refreshMyHand();
    var lbStop=document.getElementById('poker-lb-panel');
    if(lbStop)lbStop.classList.add('hidden');
    showPokerMsg('');
  }catch(e){
    console.error(e);
    showPokerMsg(e.message||'Load failed');
  }
}

function applyPokerEventSettings(ev){
  pokerEventRow=ev||null;
  var meta=parsePokerPickupMeta(ev&&ev.description);
  pokerPickupMode=meta.mode;
  pokerRadiusFt=meta.radiusFt;
  pokerResultsOpen=pokerEventCompleted(ev);
  var t=document.getElementById('poker-event-name');
  if(t)t.textContent=(ev&&ev.title)||'Poker Run';
  var r=document.getElementById('poker-geo-radius');
  if(r)r.textContent='Pickup: '+(pokerPickupMode==='qr'?'QR only':pokerPickupMode==='geo'?'GPS only':'QR or GPS')+' · radius '+pokerRadiusFt+' ft';
}

function hidePokerPlayUi(){
  var stop=document.getElementById('poker-stop-panel');
  var geo=document.getElementById('poker-geo-panel');
  var hand=document.getElementById('poker-my-hand');
  if(stop)stop.classList.add('hidden');
  if(geo)geo.classList.add('hidden');
  if(hand)hand.classList.add('hidden');
}

async function loadLeaderboardOnly(){
  showPokerMsg('Loading...');
  hidePokerPlayUi();
  try{
    const{data:ev}=await window.sb.from('events').select('*').eq('id',pokerEventId).single();
    applyPokerEventSettings(ev);
    var t=document.getElementById('poker-event-name');
    if(t)t.textContent=((ev&&ev.title)||'Poker Run')+' · Leaderboard';
    var exp=String(ev&&ev.description||'').match(/\[\[expire:(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})(?::\d{2})?\]\]/i);
    showPokerMsg(pokerResultsOpen
      ? 'Final hands are face up.'
      : (exp ? ('Cards stay face down until '+exp[1]+' at '+exp[2]+'.') : 'Cards stay face down until the event is over.'));
    await refreshLeaderboard();
  }catch(e){
    console.error(e);
    showPokerMsg(e.message||'Load failed');
  }
}

async function loadEventPokerHub(){
  showPokerMsg('Loading...');
  try{
    const{data:ev}=await window.sb.from('events').select('*').eq('id',pokerEventId).single();
    applyPokerEventSettings(ev);
    var lbHub=document.getElementById('poker-lb-panel');
    if(lbHub)lbHub.classList.add('hidden');
    await tryResumeEntry();
    await refreshMyHand();
    if(pokerPickupMode!=='qr'){
      document.getElementById('poker-stop-panel').classList.remove('hidden');
      var geo=document.getElementById('poker-geo-panel');
      if(geo)geo.classList.remove('hidden');
      var stopName=document.getElementById('poker-stop-name');
      if(stopName)stopName.textContent='Nearest checkpoint';
      var stopDesc=document.getElementById('poker-stop-desc');
      if(stopDesc)stopDesc.textContent='Stay within '+pokerRadiusFt+' ft of a flag, then draw. One card per stop.';
      await loadPokerLocations();
      await refreshPokerGps(false);
    }else{
      var geoOff=document.getElementById('poker-geo-panel');
      if(geoOff)geoOff.classList.add('hidden');
      document.getElementById('poker-stop-panel').classList.add('hidden');
    }
    showPokerMsg('');
  }catch(e){
    console.error(e);
    showPokerMsg(e.message||'Load failed');
  }
}

async function loadPokerLocations(){
  var result=await window.sb.from('poker_locations').select('*').eq('event_id',pokerEventId).eq('is_active',true).order('sort_order',{ascending:true});
  if(result.error){
    result=await window.sb.from('poker_locations').select('*').eq('event_id',pokerEventId).order('sort_order',{ascending:true});
  }
  pokerAllLocations=result.data||[];
}

function setGeoStatus(msg){
  var el=document.getElementById('poker-geo-status');
  if(el)el.textContent=msg||'';
}

async function refreshPokerGps(forcePrompt){
  if(!navigator.geolocation){
    setGeoStatus('This device has no GPS.');
    renderGeoList(null);
    return;
  }
  setGeoStatus(forcePrompt?'Getting a fresh fix…':'Getting your location…');
  try{
    var pos=await new Promise(function(resolve,reject){
      navigator.geolocation.getCurrentPosition(resolve,reject,{
        enableHighAccuracy:true,
        timeout:15000,
        maximumAge:forcePrompt?0:15000
      });
    });
    pokerLastGps={lat:pos.coords.latitude,lng:pos.coords.longitude,accFt:pos.coords.accuracy*3.28084};
    setGeoStatus('GPS ±'+Math.round(pokerLastGps.accFt)+' ft');
    renderGeoList(pokerLastGps);
    startPokerGpsWatch();
  }catch(err){
    var code=err&&err.code;
    setGeoStatus(code===1?'Location permission denied — enable it for this site.':'Could not get GPS. Try Refresh outdoors.');
    renderGeoList(null);
  }
}

function startPokerGpsWatch(){
  if(pokerGpsWatch!=null||!navigator.geolocation)return;
  pokerGpsWatch=navigator.geolocation.watchPosition(function(pos){
    pokerLastGps={lat:pos.coords.latitude,lng:pos.coords.longitude,accFt:pos.coords.accuracy*3.28084};
    setGeoStatus('GPS ±'+Math.round(pokerLastGps.accFt)+' ft');
    renderGeoList(pokerLastGps);
  },function(){},{enableHighAccuracy:true,maximumAge:5000});
}

function renderGeoList(gps){
  var list=document.getElementById('poker-geo-list');
  if(!list)return;
  if(!pokerAllLocations.length){
    list.innerHTML='<p class="text-sm text-zinc-500">No checkpoints with map flags yet.</p>';
    return;
  }
  var rows=pokerAllLocations.map(function(loc){
    var c=locCoords(loc);
    var dist=null;
    if(gps&&c)dist=haversineFeet(gps.lat,gps.lng,c.lat,c.lng);
    var inRange=dist!=null&&dist<=pokerRadiusFt;
    return{loc:loc,coords:c,dist:dist,inRange:inRange};
  }).sort(function(a,b){
    if(a.dist==null&&b.dist==null)return 0;
    if(a.dist==null)return 1;
    if(b.dist==null)return -1;
    return a.dist-b.dist;
  });
  var nearestIn=rows.find(function(r){return r.inRange;});
  if(nearestIn)pokerLocation=nearestIn.loc;
  else if(!pokerToken)pokerLocation=null;
  list.innerHTML=rows.map(function(r){
    var distLabel=r.dist==null?'No coords on this flag':(r.dist<10?Math.round(r.dist)+' ft':Math.round(r.dist)+' ft away');
    var badge=r.inRange?'<span class="text-emerald-400 text-[11px] font-semibold">IN RANGE</span>':'<span class="text-zinc-500 text-[11px]">Out of range</span>';
    return '<button type="button" onclick="selectGeoCheckpoint('+r.loc.id+')" class="w-full text-left bg-zinc-900 border '+(r.inRange?'border-emerald-700':'border-zinc-800')+' rounded-2xl px-4 py-3 flex items-center gap-3">'
      +'<i class="fa-solid fa-flag '+(r.inRange?'text-emerald-400':'text-orange-500')+'"></i>'
      +'<div class="flex-1 min-w-0"><div class="font-semibold truncate">'+escapeHtml(r.loc.name)+'</div>'
      +'<div class="text-[11px] text-zinc-500">'+distLabel+'</div></div>'+badge+'</button>';
  }).join('');
  var drawBtn=document.getElementById('btn-draw-card');
  if(drawBtn){
    drawBtn.disabled=!pokerLocation;
    drawBtn.textContent=pokerLocation?('Draw card · '+pokerLocation.name):'Get within range to draw';
  }
}

window.selectGeoCheckpoint=function(id){
  var row=pokerAllLocations.find(function(l){return Number(l.id)===Number(id);});
  if(!row)return;
  var c=locCoords(row);
  if(!pokerLastGps||!c){showToast('Need GPS and a mapped flag',true);return;}
  var dist=haversineFeet(pokerLastGps.lat,pokerLastGps.lng,c.lat,c.lng);
  if(dist>pokerRadiusFt){
    showToast('You are '+Math.round(dist)+' ft away — need '+pokerRadiusFt+' ft',true);
    return;
  }
  pokerLocation=row;
  var stop=document.getElementById('poker-stop-name');
  if(stop)stop.textContent=row.name;
  showToast('Locked onto '+row.name);
};

window.refreshPokerGps=refreshPokerGps;

function persistEntryId(entry){
  if(!entry||!entry.id||!pokerEventId)return;
  try{localStorage.setItem('poker_entry_'+pokerEventId,JSON.stringify({id:entry.id}));}catch(e){}
}

async function findExistingEntry({user,name,email}){
  if(!pokerEventId)return null;
  if(user){
    const{data}=await window.sb.from('poker_entries').select('*').eq('event_id',pokerEventId).eq('user_id',user.id).maybeSingle();
    if(data)return data;
  }
  if(email){
    const{data}=await window.sb.from('poker_entries').select('*').eq('event_id',pokerEventId).ilike('rider_email',email).maybeSingle();
    if(data)return data;
  }
  if(name){
    const{data}=await window.sb.from('poker_entries').select('*').eq('event_id',pokerEventId).ilike('rider_name',name).maybeSingle();
    if(data)return data;
  }
  if(pokerEventId){
    try{
      const saved=localStorage.getItem('poker_entry_'+pokerEventId);
      if(saved){
        const id=JSON.parse(saved).id;
        if(id){
          const{data}=await window.sb.from('poker_entries').select('*').eq('id',id).maybeSingle();
          if(data)return data;
        }
      }
    }catch(e){}
  }
  return null;
}

async function ensureEntry({user,name,email}){
  const riderName=String(name||'').trim();
  const riderEmail=String(email||'').trim();
  if(!riderName)return null;
  let existing=await findExistingEntry({user,name:riderName,email:riderEmail});
  if(existing){
    const patch={};
    if(user&&!existing.user_id)patch.user_id=user.id;
    if(riderEmail&&!existing.rider_email)patch.rider_email=riderEmail;
    if(riderName&&existing.rider_name!==riderName)patch.rider_name=riderName;
    if(Object.keys(patch).length){
      const{data}=await window.sb.from('poker_entries').update(patch).eq('id',existing.id).select().maybeSingle();
      if(data)existing=data;
    }
    return existing;
  }
  const{data,error}=await window.sb.from('poker_entries').insert({
    event_id:pokerEventId,
    rider_name:riderName,
    rider_email:riderEmail||null,
    user_id:user?user.id:null
  }).select().single();
  if(error)throw error;
  return data;
}

async function tryResumeEntry(){
  const user=await getPokerUser();
  if(user){
    pokerLockedMember=true;
    const displayName=await getLoggedInDisplayName(user);
    const email=user.email||'';
    try{
      const entry=await ensureEntry({user,name:displayName||(email?email.split('@')[0]:'Member'),email});
      if(entry){
        currentEntry=entry;
        persistEntryId(entry);
        fillRiderForm(entry);
        showJoinedState(entry.rider_name,{locked:true});
        return;
      }
    }catch(e){
      console.warn('[poker] auto-join member failed',e);
      showToast(e.message||'Could not join as member',true);
    }
    return;
  }

  pokerLockedMember=false;
  const guest=loadGuestIdentity();
  const savedName=guest&&guest.name;
  const savedEmail=guest&&guest.email;
  try{
    const existing=await findExistingEntry({user:null,name:savedName,email:savedEmail});
    if(existing){
      currentEntry=existing;
      persistEntryId(existing);
      if(!guest||!guest.name)saveGuestIdentity(existing.rider_name,existing.rider_email);
      fillRiderForm(existing);
      showJoinedState(existing.rider_name,{locked:false});
      return;
    }
  }catch(e){
    console.warn('[poker] guest resume failed',e);
  }

  if(savedName){
    try{
      const entry=await ensureEntry({user:null,name:savedName,email:savedEmail||''});
      if(entry){
        currentEntry=entry;
        persistEntryId(entry);
        fillRiderForm(entry);
        showJoinedState(entry.rider_name,{locked:false});
        return;
      }
    }catch(e){
      console.warn('[poker] guest auto-join failed',e);
    }
  }

  showJoinForm(guest||{});
}

function fillRiderForm(entry){
  const n=document.getElementById('poker-rider-name'),e=document.getElementById('poker-rider-email');
  if(n)n.value=(entry&&entry.rider_name)||'';
  if(e)e.value=(entry&&entry.rider_email)||'';
  const j=document.getElementById('poker-joined');
  if(j)j.classList.remove('hidden');
}

async function joinPokerRun(ev){
  if(ev)ev.preventDefault();
  const name=document.getElementById('poker-rider-name').value.trim();
  const email=document.getElementById('poker-rider-email').value.trim();
  if(!name){showToast('Enter your name',true);return}
  const user=await getPokerUser();
  try{
    if(!user)saveGuestIdentity(name,email);
    const entry=await ensureEntry({user,name,email});
    currentEntry=entry;
    persistEntryId(entry);
    fillRiderForm(entry);
    showJoinedState(entry.rider_name,{locked:!!user});
    showToast('You are in the run!');
    await refreshMyHand();
  }catch(err){
    showToast(err.message||'Could not join',true);
  }
}

async function drawCard(){
  if(!currentEntry){showToast('Join with your name first',true);return}
  if(!pokerLocation){
    showToast(pokerPickupMode==='qr'?'Scan a checkpoint QR first':'Get within range of a checkpoint first',true);
    return;
  }
  if(!pokerToken && pokerPickupMode!=='qr'){
    var c=locCoords(pokerLocation);
    if(!c){showToast('This checkpoint has no map coordinates',true);return;}
    if(!pokerLastGps){showToast('Turn on location and tap Refresh',true);return;}
    var dist=haversineFeet(pokerLastGps.lat,pokerLastGps.lng,c.lat,c.lng);
    if(dist>pokerRadiusFt){
      showToast('Too far — '+Math.round(dist)+' ft from '+pokerLocation.name+' (need '+pokerRadiusFt+' ft)',true);
      return;
    }
  }
  const btn=document.getElementById('btn-draw-card');
  if(btn)btn.disabled=true;
  try{
    const{data:existing}=await window.sb.from('poker_draws').select('*').eq('entry_id',currentEntry.id).eq('location_id',pokerLocation.id).maybeSingle();
    if(existing){
      showToast('Already drawn: '+existing.cards.map(cardLabel).join(' '));
      await refreshMyHand();
      return;
    }
    const{data:prior}=await window.sb.from('poker_draws').select('cards').eq('entry_id',currentEntry.id);
    const held=new Set();
    (prior||[]).forEach(d=>(d.cards||[]).forEach(c=>held.add(c)));
    const available=fullDeck().filter(c=>!held.has(c));
    if(!available.length){showToast('No cards left',true);return}
    const drawn=[shuffle(available)[0]];
    const{error}=await window.sb.from('poker_draws').insert({entry_id:currentEntry.id,location_id:pokerLocation.id,cards:drawn});
    if(error)throw error;
    const el=document.getElementById('poker-last-draw');
    if(el){
      el.classList.remove('hidden');
      var hint=document.getElementById('poker-flip-hint');
      if(hint)hint.classList.remove('hidden');
      await animateCardReveal(el,drawn[0]);
      if(hint)hint.classList.add('hidden');
    }else{
      showToast('You drew '+drawn.map(cardLabel).join(', '));
    }
    showToast('You drew '+drawn.map(cardLabel).join(', '));
    await refreshMyHand();
  }catch(err){
    showToast(err.message||'Draw failed',true);
  }finally{
    if(btn)btn.disabled=false;
  }
}

async function refreshMyHand(){
  const panel=document.getElementById('poker-my-hand');
  if(!panel||!currentEntry)return;
  const{data:draws}=await window.sb.from('poker_draws').select('cards').eq('entry_id',currentEntry.id);
  const all=[];
  (draws||[]).forEach(d=>(d.cards||[]).forEach(c=>all.push(c)));
  const scored=evaluateHand(all);
  panel.innerHTML=`<div class="text-xs text-zinc-500 mb-2">Your hand (${all.length})</div><div class="flex flex-wrap gap-2 mb-2">${all.length?all.map(function(c){return cardHtml(c,{flipped:true})}).join(''):'<span class="text-zinc-500 text-sm">No cards yet</span>'}</div><div class="text-sm text-orange-400 font-semibold">${all.length?scored.name:''}</div>`;
  panel.classList.remove('hidden');
}

async function refreshLeaderboard(){
  const panel=document.getElementById('poker-leaderboard');
  const wrap=document.getElementById('poker-lb-panel');
  if(!panel||!pokerEventId)return;
  try{
    const ent=await window.sb.from('poker_entries').select('id, rider_name').eq('event_id',pokerEventId);
    if(ent.error)throw ent.error;
    const entries=ent.data||[];
    const ids=entries.map(function(e){return e.id;});
    var drawsByEntry={};
    if(ids.length){
      const dr=await window.sb.from('poker_draws').select('entry_id, cards').in('entry_id',ids);
      if(dr.error)console.warn('[poker] draws',dr.error);
      (dr.data||[]).forEach(function(d){
        if(!drawsByEntry[d.entry_id])drawsByEntry[d.entry_id]=[];
        (d.cards||[]).forEach(function(c){drawsByEntry[d.entry_id].push(c);});
      });
    }
    const reveal=!!pokerResultsOpen;
    const rows=entries.map(function(en){
      const cards=drawsByEntry[en.id]||[];
      return{name:en.rider_name,cards:cards,scored:evaluateHand(cards),count:cards.length};
    });
    rows.sort(function(a,b){
      if(reveal)return compareScores(b.scored,a.scored)||b.count-a.count;
      return b.count-a.count||String(a.name||'').localeCompare(String(b.name||''));
    });
    var heading='<div class="flex items-baseline justify-between gap-3 mb-3"><div class="text-xs text-zinc-500">'+rows.length+' rider'+(rows.length===1?'':'s')+'</div>'+(reveal?'<div class="text-xs text-orange-400">Hands revealed</div>':'<div class="text-xs text-zinc-500">Face down until expire</div>')+'</div>';
    panel.innerHTML=heading+'<div class="space-y-2">'+(
      rows.length?rows.map(function(r,i){
        const cardsHtml=r.cards.length
          ? r.cards.map(function(c){return reveal?cardHtml(c,{flipped:true}):cardBackHtml();}).join('')
          : '<span class="text-zinc-600 text-xs">No cards</span>';
        var sub=reveal
          ? ((r.count?r.scored.name:'-')+' · '+r.count+' card'+(r.count===1?'':'s'))
          : (r.count+' card'+(r.count===1?'':'s'));
        return '<div class="bg-zinc-900 border border-zinc-800 rounded-2xl px-3 py-3"><div class="flex items-center gap-3 mb-2"><div class="text-zinc-500 font-mono w-6">'+(i+1)+'</div><div class="flex-1 min-w-0"><div class="font-semibold truncate">'+escapeHtml(r.name)+'</div><div class="text-xs text-orange-400">'+sub+'</div></div></div><div class="poker-hand-row pl-6">'+cardsHtml+'</div></div>';
      }).join(''):'<p class="text-zinc-500 text-sm">No riders yet</p>'
    )+'</div>';
    panel.classList.remove('hidden');
    if(wrap)wrap.classList.remove('hidden');
  }catch(err){
    console.error('[poker] leaderboard',err);
    panel.innerHTML='<p class="text-red-400 text-sm">'+escapeHtml(err.message||'Could not load leaderboard')+'</p>';
    panel.classList.remove('hidden');
    if(wrap)wrap.classList.remove('hidden');
  }
}

async function loadPokerAdmin(eventId){
  const panel=document.getElementById('poker-admin-panel');
  if(!panel)return;
  panel.classList.remove('hidden');
  const{data,error}=await window.sb.from('poker_locations').select('*').eq('event_id',eventId).order('sort_order',{ascending:true});
  if(error){
    panel.innerHTML=`<p class="text-red-400 text-sm">${escapeHtml(error.message)}</p><p class="text-xs text-zinc-500">Run supabase/poker_run.sql</p>`;
    return;
  }
  const base=location.origin+location.pathname.replace(/[^/]*$/,'')+'poker.html';
  panel.innerHTML=`
    <div class="flex justify-between mb-4 gap-3 flex-wrap">
      <div>
        <div class="font-bold text-lg">Poker checkpoints</div>
        <p class="text-xs text-zinc-500">One QR per trail stop · 1 card each · flag marks where to post the code</p>
      </div>
      <button type="button" onclick="addPokerLocation(${eventId})" class="px-4 py-2 rounded-2xl bg-orange-600 text-sm font-semibold">Add location</button>
    </div>
    <div class="space-y-3">${
      (data||[]).map(loc=>{
        const url=`${base}?e=${eventId}&t=${loc.qr_token}`;
        const qr=`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`;
        const coords=(loc.lat!=null&&loc.lng!=null)
          ? `<div class="text-[10px] text-zinc-400 mt-1"><i class="fa-solid fa-flag text-orange-500 mr-1"></i>${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}</div>`
          : '';
        const mapsLink=(loc.lat!=null&&loc.lng!=null)
          ? `<a href="https://www.google.com/maps?q=${loc.lat},${loc.lng}" target="_blank" rel="noopener" class="text-xs border border-zinc-600 px-3 py-1 rounded-xl">Map</a>`
          : '';
        return `<div class="border border-zinc-700 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 bg-zinc-950">
          <img src="${qr}" class="w-32 h-32 bg-white p-1 rounded-xl" alt="QR">
          <div class="flex-1 min-w-0">
            <div class="font-semibold">${escapeHtml(loc.name)}</div>
            ${coords}
            <div class="text-[10px] text-zinc-600 break-all mt-1">${escapeHtml(url)}</div>
            <div class="mt-2 flex flex-wrap gap-2">
              <a href="${qr}" target="_blank" class="text-xs border border-zinc-600 px-3 py-1 rounded-xl">Open QR</a>
              ${mapsLink}
              <button type="button" onclick="deletePokerLocation(${loc.id},${eventId})" class="text-xs text-red-400 border border-red-900 px-3 py-1 rounded-xl">Delete</button>
            </div>
          </div>
        </div>`;
      }).join('') || '<p class="text-zinc-500 text-sm">No checkpoints yet</p>'
    }</div>
    <div class="mt-4 text-xs text-zinc-500">Leaderboard posts when the event is marked completed.</div>`;
}

async function addPokerLocation(eventId){
  const name=prompt('Checkpoint name (e.g. Trailhead, Mid climb)');
  if(!name)return;
  const description=prompt('Note / description (optional)')||'';
  let lat=null,lng=null;
  const coords=prompt('Optional: lat,lng where the QR will be posted\n(e.g. 50.04123, -110.68100)\nLeave blank to skip');
  if(coords&&coords.trim()){
    const parts=coords.split(/[,\s]+/).map(Number).filter(n=>!isNaN(n));
    if(parts.length>=2){lat=parts[0];lng=parts[1];}
  }
  const row={event_id:eventId,name:name.trim(),description:description.trim()||null,sort_order:Date.now()%100000};
  if(lat!=null&&lng!=null){row.lat=lat;row.lng=lng;}
  let{error}=await window.sb.from('poker_locations').insert(row);
  if(error&&row.lat!=null){
    delete row.lat;delete row.lng;
    row.description=(row.description?row.description+' · ':'')+'📍 '+lat.toFixed(5)+', '+lng.toFixed(5);
    ({error}=await window.sb.from('poker_locations').insert(row));
  }
  if(error)showToast(error.message,true);
  else{showToast('Added');await loadPokerAdmin(eventId);}
}

async function deletePokerLocation(id,eventId){
  if(!confirm('Delete checkpoint?'))return;
  const{error}=await window.sb.from('poker_locations').delete().eq('id',id);
  if(error)showToast(error.message,true);
  else{showToast('Deleted');await loadPokerAdmin(eventId);}
}

document.addEventListener('DOMContentLoaded',()=>{if(document.body&&document.body.getAttribute('data-page')==='poker')initPokerPage()});