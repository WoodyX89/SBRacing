// SB Racing Poker Run
const SUITS=['S','H','D','C'],RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL=Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));
function fullDeck(){const d=[];for(const r of RANKS)for(const s of SUITS)d.push(r+s);return d}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function parseCard(c){return{code:c,rank:c.slice(0,-1),suit:c.slice(-1),val:RANK_VAL[c.slice(0,-1)]}}
function cardLabel(c){const p=parseCard(c);return p.rank+p.suit}
function evaluateHand(codes){
  if(!codes||!codes.length)return{rank:0,name:'No cards',tiebreak:[]};
  const vals=codes.map(c=>parseCard(c).val).sort((a,b)=>b-a);
  const counts={};vals.forEach(v=>counts[v]=(counts[v]||0)+1);
  const by=Object.entries(counts).map(([v,c])=>({val:+v,count:c})).sort((a,b)=>b.count-a.count||b.val-a.val);
  if(by[0].count===4)return{rank:7,name:'Four of a Kind',tiebreak:[by[0].val]};
  if(by[0].count===3&&by[1]&&by[1].count===2)return{rank:6,name:'Full House',tiebreak:[by[0].val,by[1].val]};
  if(by[0].count===3)return{rank:3,name:'Three of a Kind',tiebreak:[by[0].val]};
  if(by[0].count===2&&by[1]&&by[1].count===2)return{rank:2,name:'Two Pair',tiebreak:[by[0].val,by[1].val]};
  if(by[0].count===2)return{rank:1,name:'One Pair',tiebreak:[by[0].val]};
  return{rank:0,name:'High Card',tiebreak:vals};
}
function compareScores(a,b){if(a.rank!==b.rank)return a.rank-b.rank;for(let i=0;i<5;i++){const d=(a.tiebreak[i]||0)-(b.tiebreak[i]||0);if(d)return d}return 0}
function escapeHtml(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):''}
const SUIT_GLYPH = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };

function cardHtml(code, opts) {
  opts = opts || {};
  var large = !!opts.large;
  var flipped = opts.flipped === true; // face-up only when requested
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

function animateCardReveal(container, code) {
  if (!container) return Promise.resolve();
  // Show deck image (back). User taps to flip and reveal the drawn card.
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
    // Also allow keyboard / accessibility
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Tap to reveal your card');
  });
}


let pokerEventId=null,pokerToken=null,pokerLocation=null,currentEntry=null;
function getQuery(){const q=new URLSearchParams(location.search);return{eventId:q.get('e')||q.get('event'),token:q.get('t')||q.get('token')}}
function showPokerMsg(m){const el=document.getElementById('poker-status');if(!el)return;el.textContent=m||'';el.classList.toggle('hidden',!m)}
async function initPokerPage(){const q=getQuery();pokerEventId=q.eventId?parseInt(q.eventId,10):null;pokerToken=q.token;if(!window.sb){setTimeout(initPokerPage,150);return}if(pokerEventId&&pokerToken)await loadStopMode();else if(pokerEventId)await loadLeaderboardOnly();else showPokerMsg('Scan a checkpoint QR code to draw a card.')}
async function loadStopMode(){showPokerMsg('Loading...');try{const{data:loc,error}=await window.sb.from('poker_locations').select('*').eq('qr_token',pokerToken).eq('event_id',pokerEventId).maybeSingle();if(error)throw error;if(!loc||!loc.is_active){showPokerMsg('Invalid checkpoint QR.');return}pokerLocation=loc;const{data:ev}=await window.sb.from('events').select('*').eq('id',pokerEventId).single();document.getElementById('poker-stop-panel').classList.remove('hidden');document.getElementById('poker-stop-name').textContent=loc.name;document.getElementById('poker-event-name').textContent=(ev&&ev.title)||'Poker Run';document.getElementById('poker-stop-desc').textContent=loc.description||'Draw your card for this checkpoint.';await tryResumeEntry();await refreshMyHand();await refreshLeaderboard();showPokerMsg('')}catch(e){console.error(e);showPokerMsg(e.message||'Load failed')}}
async function loadLeaderboardOnly(){document.getElementById('poker-stop-panel').classList.add('hidden');document.getElementById('poker-lb-panel').classList.remove('hidden');const{data:ev}=await window.sb.from('events').select('*').eq('id',pokerEventId).single();const t=document.getElementById('poker-event-name');if(t)t.textContent=(ev&&ev.title)||'Poker Run';await refreshLeaderboard();showPokerMsg('')}
async function tryResumeEntry(){let user=null;try{user=await getCurrentUser()}catch(e){}if(user){const{data}=await window.sb.from('poker_entries').select('*').eq('event_id',pokerEventId).eq('user_id',user.id).maybeSingle();if(data){currentEntry=data;fillRiderForm(data);return}}const saved=localStorage.getItem('poker_entry_'+pokerEventId);if(saved){try{const id=JSON.parse(saved).id;const{data}=await window.sb.from('poker_entries').select('*').eq('id',id).maybeSingle();if(data){currentEntry=data;fillRiderForm(data)}}catch(e){}}}
function fillRiderForm(entry){const n=document.getElementById('poker-rider-name'),e=document.getElementById('poker-rider-email');if(n)n.value=entry.rider_name||'';if(e)e.value=entry.rider_email||'';const j=document.getElementById('poker-joined');if(j)j.classList.remove('hidden')}
async function joinPokerRun(ev){if(ev)ev.preventDefault();const name=document.getElementById('poker-rider-name').value.trim();const email=document.getElementById('poker-rider-email').value.trim();if(!name){showToast('Enter your name',true);return}let user=null;try{user=await getCurrentUser()}catch(e){}try{if(email){const{data:ex}=await window.sb.from('poker_entries').select('*').eq('event_id',pokerEventId).ilike('rider_email',email).maybeSingle();if(ex){currentEntry=ex;localStorage.setItem('poker_entry_'+pokerEventId,JSON.stringify({id:ex.id}));fillRiderForm(ex);showToast('Welcome back');await refreshMyHand();return}}const{data,error}=await window.sb.from('poker_entries').insert({event_id:pokerEventId,rider_name:name,rider_email:email||null,user_id:user?user.id:null}).select().single();if(error)throw error;currentEntry=data;localStorage.setItem('poker_entry_'+pokerEventId,JSON.stringify({id:data.id}));fillRiderForm(data);showToast('You are in the run!');await refreshMyHand()}catch(err){showToast(err.message||'Could not join',true)}}
async function drawCard(){if(!currentEntry){showToast('Join with your name first',true);return}if(!pokerLocation)return;const btn=document.getElementById('btn-draw-card');if(btn)btn.disabled=true;try{const{data:existing}=await window.sb.from('poker_draws').select('*').eq('entry_id',currentEntry.id).eq('location_id',pokerLocation.id).maybeSingle();if(existing){showToast('Already drawn: '+existing.cards.map(cardLabel).join(' '));await refreshMyHand();return}const{data:prior}=await window.sb.from('poker_draws').select('cards').eq('entry_id',currentEntry.id);const held=new Set();(prior||[]).forEach(d=>(d.cards||[]).forEach(c=>held.add(c)));const available=fullDeck().filter(c=>!held.has(c));if(!available.length){showToast('No cards left',true);return}const drawn=[shuffle(available)[0]];const{error}=await window.sb.from('poker_draws').insert({entry_id:currentEntry.id,location_id:pokerLocation.id,cards:drawn});if(error)throw error;const el=document.getElementById('poker-last-draw');if(el){el.classList.remove('hidden');var hint=document.getElementById('poker-flip-hint');if(hint)hint.classList.remove('hidden');await animateCardReveal(el,drawn[0]);if(hint)hint.classList.add('hidden')}else{showToast('You drew '+drawn.map(cardLabel).join(', '))}showToast('You drew '+drawn.map(cardLabel).join(', '));await refreshMyHand();await refreshLeaderboard()}catch(err){showToast(err.message||'Draw failed',true)}finally{if(btn)btn.disabled=false}}
async function refreshMyHand(){const panel=document.getElementById('poker-my-hand');if(!panel||!currentEntry)return;const{data:draws}=await window.sb.from('poker_draws').select('cards').eq('entry_id',currentEntry.id);const all=[];(draws||[]).forEach(d=>(d.cards||[]).forEach(c=>all.push(c)));const scored=evaluateHand(all);panel.innerHTML=`<div class="text-xs text-zinc-500 mb-2">Your hand (${all.length})</div><div class="flex flex-wrap gap-2 mb-2">${all.length?all.map(function(c){return cardHtml(c,{flipped:true})}).join(''):'<span class="text-zinc-500 text-sm">No cards yet</span>'}</div><div class="text-sm text-orange-400 font-semibold">${all.length?scored.name:''}</div>`;panel.classList.remove('hidden')}
async function refreshLeaderboard(){
  const panel=document.getElementById('poker-leaderboard');
  if(!panel||!pokerEventId)return;
  const{data:entries}=await window.sb.from('poker_entries').select('id, rider_name, poker_draws(cards)').eq('event_id',pokerEventId);
  const rows=(entries||[]).map(en=>{
    const cards=[];
    (en.poker_draws||[]).forEach(d=>(d.cards||[]).forEach(c=>cards.push(c)));
    return{name:en.rider_name,cards,scored:evaluateHand(cards),count:cards.length};
  });
  rows.sort((a,b)=>compareScores(b.scored,a.scored)||b.count-a.count);
  panel.innerHTML='<div class="text-xs text-zinc-500 mb-3">Leaderboard</div><div class="space-y-2">'+(
    rows.length?rows.map((r,i)=>{
      const cardsHtml=r.cards.length?r.cards.map(c=>cardHtml(c,{flipped:true})).join(''):'<span class="text-zinc-600 text-xs">No cards</span>';
      return '<div class="bg-zinc-900 border border-zinc-800 rounded-2xl px-3 py-3"><div class="flex items-center gap-3 mb-2"><div class="text-zinc-500 font-mono w-6">'+(i+1)+'</div><div class="flex-1 min-w-0"><div class="font-semibold truncate">'+escapeHtml(r.name)+'</div><div class="text-xs text-orange-400">'+(r.count?r.scored.name:'-')+' · '+r.count+' cards</div></div></div><div class="poker-hand-row pl-6">'+cardsHtml+'</div></div>';
    }).join(''):'<p class="text-zinc-500 text-sm">No riders yet</p>'
  )+'</div>';
  panel.classList.remove('hidden');
  const lb=document.getElementById('poker-lb-panel');
  if(lb)lb.classList.remove('hidden');
}

async function loadPokerAdmin(eventId){const panel=document.getElementById('poker-admin-panel');if(!panel)return;panel.classList.remove('hidden');const{data,error}=await window.sb.from('poker_locations').select('*').eq('event_id',eventId).order('sort_order',{ascending:true});if(error){panel.innerHTML=`<p class="text-red-400 text-sm">${escapeHtml(error.message)}</p><p class="text-xs text-zinc-500">Run supabase/poker_run.sql</p>`;return}const base=location.origin+location.pathname.replace(/[^/]*$/,'')+'poker.html';panel.innerHTML=`<div class="flex justify-between mb-4 gap-3 flex-wrap"><div><div class="font-bold text-lg">Poker checkpoints</div><p class="text-xs text-zinc-500">One QR per trail stop · 1 card each</p></div><button type="button" onclick="addPokerLocation(${eventId})" class="px-4 py-2 rounded-2xl bg-orange-600 text-sm font-semibold">Add location</button></div><div class="space-y-3">${(data||[]).map(loc=>{const url=`${base}?e=${eventId}&t=${loc.qr_token}`;const qr=`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`;return`<div class="border border-zinc-700 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 bg-zinc-950"><img src="${qr}" class="w-32 h-32 bg-white p-1 rounded-xl"><div class="flex-1 min-w-0"><div class="font-semibold">${escapeHtml(loc.name)}</div><div class="text-[10px] text-zinc-600 break-all mt-1">${escapeHtml(url)}</div><div class="mt-2 flex gap-2"><a href="${qr}" target="_blank" class="text-xs border border-zinc-600 px-3 py-1 rounded-xl">Open QR</a><button type="button" onclick="deletePokerLocation(${loc.id},${eventId})" class="text-xs text-red-400 border border-red-900 px-3 py-1 rounded-xl">Delete</button></div></div></div>`}).join('')||'<p class="text-zinc-500 text-sm">No checkpoints yet</p>'}</div><div class="mt-4"><a class="text-orange-500 text-sm" href="poker.html?e=${eventId}">Leaderboard →</a></div>`}
async function addPokerLocation(eventId){const name=prompt('Checkpoint name');if(!name)return;const description=prompt('Description (optional)')||'';const{error}=await window.sb.from('poker_locations').insert({event_id:eventId,name:name.trim(),description:description.trim()||null,sort_order:Date.now()%100000});if(error)showToast(error.message,true);else{showToast('Added');await loadPokerAdmin(eventId)}}
async function deletePokerLocation(id,eventId){if(!confirm('Delete checkpoint?'))return;const{error}=await window.sb.from('poker_locations').delete().eq('id',id);if(error)showToast(error.message,true);else{showToast('Deleted');await loadPokerAdmin(eventId)}}
document.addEventListener('DOMContentLoaded',()=>{if(document.body&&document.body.getAttribute('data-page')==='poker')initPokerPage()});
