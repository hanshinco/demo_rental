/* ===== データ（バックエンドから） ===== */
let products=[],units=[],makerCat={},reservations=[],usersData=[],ME={name:'',role:''};
// ⚠ canOffice/canField は「画面のボタンを出すか」だけを決める“見た目”の制御。
//    防御ではない（コンソールから google.script.run.<関数>() を直接呼べば迂回できる）。
//    実際の権限判定はサーバ側 Code.gs の requireRole_ が行う＝唯一の防御線。
const canOffice=()=>ME.role==='事務所';                       // 受付・予約・編集・設定・ユーザー登録
const canField=()=>ME.role==='事務所'||ME.role==='倉庫';      // 出荷確定・返却・個体登録など現場操作（閲覧は不可）
const isHoldS=k=>k==='検品待ち'||k==='付属品待ち';            // 「保留」相当の状態キー判定
const TODAY=new Date();TODAY.setHours(0,0,0,0);
const WIN_START=new Date(TODAY);WIN_START.setDate(WIN_START.getDate()-21);
const WIN_END=new Date(TODAY);WIN_END.setDate(WIN_END.getDate()+35);
const fmt=dt=>(dt.getMonth()+1)+'/'+dt.getDate();
const fmtY=dt=>dt?dt.getFullYear()+'/'+String(dt.getMonth()+1).padStart(2,'0')+'/'+String(dt.getDate()).padStart(2,'0'):'';
const ymd=s=>s?String(s).slice(0,10).replace(/-/g,'/'):'';   // 'YYYY-MM-DD'文字列 → 'YYYY/MM/DD'
const days=(a,b)=>Math.round((b-a)/86400000);
const esc=s=>(''+(s==null?'':s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pd=s=>s?new Date(String(s).slice(0,10)+'T00:00:00'):null;

function boot(){
  if(typeof google==='undefined'||!google.script){document.getElementById('loading').textContent='このページはGAS（ウェブアプリ）として開いてください。';return;}
  google.script.run.withSuccessHandler(applyData).withFailureHandler(e=>document.getElementById('loading').textContent='エラー: '+e.message).getBootstrap();
}
function applyData(d){
  products=d.products;makerCat=d.makerCat;usersData=d.usersData;ME=d.me;
  reservations=d.reservations.map(r=>({...r,start:pd(r.start),end:pd(r.end)}));
  units=d.units.map(u=>({...u,loan:u.loan?{...u.loan,ship:pd(u.loan.ship),due:pd(u.loan.due),returned:pd(u.loan.returned)}:null}));
  document.getElementById('loading').style.display='none';document.getElementById('app').style.display='';
  document.getElementById('whoH').innerHTML='👤 <b>'+esc(ME.name)+'</b>（'+esc(ME.role)+'）';
  const bn=document.getElementById('btnNew');if(bn)bn.style.display=canOffice()?'':'none';   // 受付は事務所のみ
  applyRoute(true);   // 現在のURL(ハッシュ)に従って描画。deep link/リロードでも同じ画面に復元
  busyOff();   // 再読込→再描画が完全に終わってからクルクルを消す
}
function reload(){google.script.run.withSuccessHandler(applyData).getBootstrap();}
function staffOptions(sel){return usersData.filter(u=>u.role!=='閲覧').map(u=>`<option ${u.name===sel?'selected':''}>${esc(u.name)}</option>`).join('');}
function allStaffOptions(sel){return usersData.map(u=>`<option ${u.name===sel?'selected':''}>${esc(u.name)}</option>`).join('');}   // 依頼担当=営業含む全員

/* ===== 状態判定 ===== */
function statusOf(u){const l=u.loan;
  if(!l)return{key:'貸出可',dot:'green'};
  if(l.hold)return{key:l.hold,dot:'amber'};
  if(l.returned)return{key:'貸出可',dot:'green'};
  if(!l.shipped)return{key:'出荷待ち',dot:'wait'};
  if(l.dueType==='日付指定'){const d=days(TODAY,l.due);if(d<0)return{key:'貸出中',alert:'超過',dot:'red'};if(d<=7)return{key:'貸出中',alert:'間近',dot:'amber'};return{key:'貸出中',dot:'blue'};}
  const e=days(l.ship,TODAY);if(e>90)return{key:'貸出中',alert:'長期',undated:true,dot:'gray'};return{key:'貸出中',undated:true,dot:'gray'};}
const unitsOf=c=>units.filter(u=>u.prod===c);
const prodOf=c=>products.find(p=>p.code===c)||{code:c,name:c,maker:'',cat:''};
const circNo=n=>(n>=1&&n<=20)?'①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.charAt(n-1):'('+n+')';   // 丸数字（21以上は(21)）
const typeText=u=>esc(u.type)+(u&&u.mgmt?circNo(parseInt(u.mgmt,10)):'');   // 種別＋管理番号（DB保存値・項目化）。在庫は番号なし
const nextMgmt=(code,type)=>{if(!code||type==='在庫'||!type)return'（採番なし）';let max=0;unitsOf(code).forEach(u=>{if(u.type===type){const n=parseInt(u.mgmt,10);if(!isNaN(n))max=Math.max(max,n);}});return type+circNo(max+1);};   // 個体登録のプレビュー（目安・確定はサーバ）
const recip=l=>l?(l.customer||l.ship2||''):'';   // 表示用の宛先（会社名→無ければ担当者）
const noteI=n=>n?` <span class="ni" data-tip="${esc(n)}">i</span>`:'';   // 備考(i)マーク
const nextAuto=c=>{if(!c)return'（商品を選ぶと生成）';let max=0;unitsOf(c).forEach(u=>{const sn=String(u.sn);if(sn.indexOf(c+'-')===0){const n=parseInt(sn.slice((c+'-').length),10);if(n>0)max=Math.max(max,n);}});return c+'-'+String(max+1).padStart(3,'0');};   // 自動採番プレビュー（既存の最大+1）
function kpi(c){let a=0,o=0,ins=0,att=0;unitsOf(c).forEach(u=>{const s=statusOf(u);s.key==='貸出可'?a++:s.key==='検品待ち'?ins++:s.key==='付属品待ち'?att++:o++;});return{total:unitsOf(c).length,avail:a,out:o,ins:ins,att:att};}
function alertsIn(list){let over=0,soon=0,longg=0;list.forEach(u=>{const s=statusOf(u);if(s.alert==='超過')over++;if(s.alert==='間近')soon++;if(s.alert==='長期')longg++;});return{over,soon,longg};}
function chips(a){let h='';if(a.over)h+=`<span class="chip red">🟥 超過 ${a.over}</span>`;if(a.soon)h+=`<span class="chip amber">🟨 返却間近 ${a.soon}</span>`;if(a.longg)h+=`<span class="chip warn">⚠ 長期確認 ${a.longg}</span>`;return h||'<span class="note">アラートなし</span>';}

/* ===== ナビ ===== */
const MENU=[{k:'dashboard',ic:'🏠',t:'ダッシュボード'},{k:'search',ic:'🔍',t:'商品検索'},{k:'cases',ic:'📑',t:'案件一覧',sub:[{k:'shipwait',t:'出荷待ち一覧'},{k:'active',t:'貸出中一覧'},{k:'reserve',t:'予約一覧'},{k:'completed',t:'完了案件'}]},{k:'unitReg',ic:'🏷',t:'商品登録',info:'サンプルを追加するときや新商品を登録するときに使用',need:'field'},{k:'users',ic:'👥',t:'ユーザー登録',need:'office'},{k:'settings',ic:'⚙',t:'設定・通知',need:'office'}];
const CASEKEYS=['shipwait','active','reserve','completed'];   // 「案件一覧」配下のサブ画面
let section='dashboard',selected='',view='gantt',zoomPx=26,listFilter='active',casesOpen=false;const expanded=new Set();
/* ===== ルーティング（History API パス型 /… 。戻る/進む/ブックマーク/共有・リロードOK） ===== */
const SECTIONS=['dashboard','search','shipwait','active','reserve','completed','unitReg','users','settings'];
const BASE=window.__BASE||'/';   // GitHub Pagesのサブパス(/demo_rental/)かローカル(/)を吸収
let _route={section:null,selected:null,listFilter:null},_detail=null;
function pathSeg(){   // 現在の状態→URLのパス（BASE配下・クエリなし）
  let seg;
  if(section==='search')seg=selected?'search/'+encodeURIComponent(selected):'search';
  else if(section==='active')seg=(listFilter&&listFilter!=='active')?'active/'+encodeURIComponent(listFilter):'active';
  else seg=(section==='dashboard')?'':section;
  return BASE+seg;}
function parseRoute(){let path=location.pathname;if(path.indexOf(BASE)===0)path=path.slice(BASE.length);
  const segs=path.split('/').filter(Boolean),sec=SECTIONS.indexOf(segs[0])>=0?segs[0]:'dashboard';
  const r={section:sec,selected:'',listFilter:'active',detail:null};
  if(sec==='search'&&segs[1])r.selected=decodeURIComponent(segs[1]);
  if(sec==='active'&&segs[1])r.listFilter=decodeURIComponent(segs[1]);
  const q=new URLSearchParams(location.search),k=q.get('panel'),id=q.get('id');if(k&&id)r.detail={kind:k,id:id};
  return r;}
function navigate(url){if(url===location.pathname+location.search)return;history.pushState(null,'',url);applyRoute(false);}
function applyRoute(force){const n=parseRoute();
  const secCh=force||n.section!==_route.section,selCh=force||n.selected!==_route.selected,filCh=force||n.listFilter!==_route.listFilter;
  section=n.section;selected=n.selected;listFilter=n.listFilter;
  if(CASEKEYS.indexOf(section)>=0)casesOpen=true;
  if(secCh)render();
  else if(section==='search'&&selCh){const inp=document.getElementById('search');buildTree(inp?inp.value.trim().toLowerCase():'');renderProduct();}
  else if(section==='active'&&filCh){renderMenu();renderActive();}
  _route={section,selected,listFilter};
  syncDetail(n.detail,force);}
window.addEventListener('popstate',function(){applyRoute(false);});   // 戻る/進む
function go(s){
  if(s==='cases'){casesOpen=!casesOpen;if(casesOpen&&CASEKEYS.indexOf(section)<0)navigate(BASE+'shipwait');else renderLeft();return;}
  if(s==='search'){navigate(BASE+(selected?'search/'+encodeURIComponent(selected):'search'));return;}
  if(s==='active'){navigate(BASE+'active');return;}
  navigate(BASE+(s==='dashboard'?'':s));}
function goList(f){navigate(BASE+(f==='active'?'active':'active/'+encodeURIComponent(f)));}
function render(){renderLeft();({dashboard:renderDashboard,search:renderProduct,shipwait:renderShipWait,active:renderActive,reserve:renderReserve,completed:renderCompleted,unitReg:renderUnitReg,users:renderUsers,settings:renderSettings}[section])();}
/* パネル（レコード詳細）もURL化：戻るで閉じる・URL共有で直接開ける */
function syncDetail(d,force){
  if(!d){if(_detail){_detail=null;hidePanel();}return;}
  if(!force&&_detail&&_detail.kind===d.kind&&_detail.id===d.id)return;
  _detail=d;
  try{if(d.kind==='loan')openPanelView(d.id);else if(d.kind==='unit')openUnitPanelView(d.id);else if(d.kind==='resv')openResvPanelView(d.id);else throw 0;}
  catch(e){_detail=null;hidePanel();if(location.search)history.replaceState(null,'',pathSeg());}}
function openDetail(kind,id){navigate(pathSeg()+'?panel='+kind+'&id='+encodeURIComponent(id));}
function openPanel(uid){openDetail('loan',uid);}
function openUnitPanel(uid){openDetail('unit',uid);}
function openResvPanel(rid){openDetail('resv',rid);}
function renderLeft(){const aside=document.querySelector('.left');
  if(section==='search'){aside.innerHTML=`<div class="backbar"><button class="circ" onclick="go('dashboard')">←</button><span class="bt">商品検索</span></div><div class="subpane" id="subpane" style="display:flex"></div>`;renderSubTree();}
  else{aside.innerHTML=`<nav class="menu" id="menu"></nav>`;renderMenu();}}
function renderMenu(){const el=document.getElementById('menu');if(!el)return;el.innerHTML=MENU.filter(m=>!m.need||(m.need==='office'?canOffice():canField())).map(m=>{
  if(m.sub){const open=casesOpen||CASEKEYS.indexOf(section)>=0;
    return `<div class="mi" onclick="go('cases')"><span class="ic">${m.ic}</span>${m.t}<span class="mcaret">${open?'▾':'▸'}</span></div>`+(open?`<div class="submenu">${m.sub.map(c=>`<div class="mi sub ${c.k===section?'active':''}" onclick="go('${c.k}')">${c.t}</div>`).join('')}</div>`:'');}
  return `<div class="mi ${m.k===section?'active':''}" onclick="go('${m.k}')"><span class="ic">${m.ic}</span>${m.t}${m.info?`<span class="info" data-tip="${m.info}" onclick="event.stopPropagation()">i</span>`:''}</div>`;}).join('');}

function renderSubTree(){document.getElementById('subpane').innerHTML=`<div class="search"><input id="search" placeholder="🔍 品名・シリアル・貸出先" oninput="onSearch()"></div><div class="ttl">製品ツリー</div><div class="tree" id="tree"></div>`;buildTree('');}
function buildTree(f){const mk={};products.forEach(p=>{if(f){const hit=(p.name+p.code+p.cat).toLowerCase().includes(f)||unitsOf(p.code).some(u=>(u.sn+(u.loan?u.loan.customer:'')).toLowerCase().includes(f));if(!hit)return;}(mk[p.maker]=mk[p.maker]||{}),(mk[p.maker][p.cat]=mk[p.maker][p.cat]||[]).push(p);});
  const tree=document.getElementById('tree');tree.innerHTML='';
  Object.keys(mk).sort().forEach(m=>{const mK='m:'+m,mEl=node('maker',m,mK,!!f||expanded.has(mK));
    Object.keys(mk[m]).forEach(cat=>{const cK='c:'+m+'>'+cat,cEl=node('cat',cat,cK,!!f||expanded.has(cK));
      mk[m][cat].forEach(p=>{const k=kpi(p.code),pEl=document.createElement('div');pEl.className='node prod'+(p.code===selected?' sel':'');
        pEl.innerHTML=`<div class="row"><span class="caret"></span><span class="name">${esc(p.name)}</span><span class="badge tnum ${k.avail===0?'zero':''}">${k.avail}/${k.total}</span></div>`;
        pEl.querySelector('.row').onclick=()=>{navigate(BASE+'search/'+encodeURIComponent(p.code));};cEl._k.appendChild(pEl);});
      mEl._k.appendChild(cEl);});tree.appendChild(mEl);});}
function node(cls,label,key,open){const el=document.createElement('div');el.className='node '+cls;el.innerHTML=`<div class="row"><span class="caret">${open?'▾':'▸'}</span><span class="name">${esc(label)}</span></div>`;const k=document.createElement('div');if(!open)k.className='hide';el.appendChild(k);el._k=k;
  el.querySelector('.row').onclick=()=>{if(expanded.has(key))expanded.delete(key);else expanded.add(key);k.classList.toggle('hide');el.querySelector('.caret').textContent=k.classList.contains('hide')?'▸':'▾';};return el;}
function onSearch(){buildTree(document.getElementById('search').value.trim().toLowerCase());}

function renderProduct(){if(!selected){document.getElementById('main').innerHTML=`<div class="empty"><div><div class="big">🔍</div>左の製品ツリー、または検索ボックスから<br>商品を選んでください。</div></div>`;return;}
  const p=prodOf(selected),k=kpi(p.code);
  document.getElementById('main').innerHTML=`<div class="sechead"><h2>${esc(p.name)}</h2><span class="meta">[${esc(p.code)}] ${esc(p.maker)} / ${esc(p.cat)}</span><span class="pAlerts">${chips(alertsIn(unitsOf(p.code)))}</span></div>
    <div class="kpis"><div class="kpi"><div class="lab">総数</div><div class="val tnum">${k.total}</div></div><div class="kpi k-avail ${k.avail===0?'zero':''}"><div class="lab">貸出可（残数）</div><div class="val tnum">${k.avail}</div></div><div class="kpi k-out"><div class="lab">貸出中</div><div class="val tnum">${k.out}</div></div><div class="kpi k-hold"><div class="lab">検品待ち</div><div class="val tnum">${k.ins}</div></div><div class="kpi k-hold"><div class="lab">付属品待ち</div><div class="val tnum">${k.att}</div></div></div>
    <div class="toolbar"><span class="toggle"><button class="${view==='gantt'?'on':''}" onclick="setView('gantt')">ガント</button><button class="${view==='list'?'on':''}" onclick="setView('list')">一覧</button></span>${view==='gantt'?`<span class="zoom"><button class="${zoomPx===26?'on':''}" onclick="setZoom(26)">日</button><button class="${zoomPx===12?'on':''}" onclick="setZoom(12)">週</button><button class="${zoomPx===6?'on':''}" onclick="setZoom(6)">月</button></span>`:''}<span class="spacer"></span>${canOffice()?`<button class="btn" onclick="openResv('${p.code}')">🗓 予約追加</button>`:''}</div>
    <div id="viewArea"></div>`;
  view==='gantt'?renderGantt():renderListView();}
function setView(v){view=v;renderProduct();}function setZoom(z){zoomPx=z;renderProduct();}

function renderGantt(){const us=unitsOf(selected),total=days(WIN_START,WIN_END),W=total*zoomPx,x=dt=>days(WIN_START,dt)*zoomPx,todayX=x(TODAY);
  let ticks='';for(let i=0;i<=total;i++){const dt=new Date(WIN_START.getTime()+i*86400000),mon=dt.getDay()===1,lab=zoomPx>=26?true:(zoomPx>=12?mon:dt.getDate()===1);ticks+=`<div class="tick ${mon?'mon':''}" style="left:${i*zoomPx}px"></div>`;if(lab)ticks+=`<div class="ticklab" style="left:${i*zoomPx}px">${fmt(dt)}</div>`;}
  let labels=`<div class="ghcell">シリアル / 貸出先</div>`,lines='';
  us.forEach(u=>{const s=statusOf(u),l=u.loan,active=l&&l.shipped&&!l.returned&&!l.hold,clk=(s.key==='貸出中'||isHoldS(s.key)||s.key==='出荷待ち');
    const who=active?recip(l):(isHoldS(s.key)?s.key:s.key==='出荷待ち'?`出荷待ち（${recip(l)}）`:'空き');
    labels+=`<div class="lcell click${s.key==='貸出可'?' avail':''}" onclick="openUnitPanel('${u.id}')"><span class="sn">#${esc(u.sn)}${noteI(u.note)}</span><span class="mg">${typeText(u)}</span><span class="who">${esc(who)}</span></div>`;
    let bar='';
    if(active){const start=l.ship<WIN_START?WIN_START:l.ship,undated=l.dueType!=='日付指定',end=undated?WIN_END:(l.due>WIN_END?WIN_END:l.due),left=x(start),w=Math.max(x(end)-left,10);
      const cls=undated?('undated'+(s.alert==='長期'?' warn':'')):(s.alert==='超過'?'red':s.alert==='間近'?'amber':'blue');
      const clipL=l.ship<WIN_START?`<span class="clipL" style="left:${left-12}px">◀</span>`:'';const arrow=(undated||l.due>WIN_END)?`<span class="arrow">→</span>`:'';
      const tag=s.alert==='超過'?' 🟥':s.alert==='間近'?' 🟨':s.alert==='長期'?' ⚠':'';const dueTxt=l.dueType==='日付指定'?fmtY(l.due)+'まで':l.dueType;
      const tip=`<b>${esc(recip(l))}</b><br>#${esc(u.sn)} ${typeText(u)}<br>${fmtY(l.ship)} 〜 ${dueTxt}<br>経過 ${days(l.ship,TODAY)}日${s.alert?'　／　'+s.alert:''}`;
      bar+=`${clipL}<div class="bar ${cls}" style="left:${left}px;width:${w}px" data-tip="${esc(tip)}" onclick="openPanel('${u.id}')">${esc(recip(l))}${tag}${arrow}</div>`;
    }else if(!l){bar+=`<span class="emptyrow">貸出可（空き）</span>`;}else if(l.hold){bar+=`<span class="emptyrow">${esc(l.hold)}</span>`;}else{bar+=`<span class="emptyrow">出荷待ち</span>`;}
    reservations.filter(r=>r.unit===u.id).forEach(r=>{const left=x(r.start<WIN_START?WIN_START:r.start),end=r.end>WIN_END?WIN_END:r.end,w=Math.max(x(end)-left,10);
      const tip=`<b>🗓 予約：${esc(r.customer)}</b><br>${fmt(r.start)} 〜 ${fmt(r.end)}<br>受付：${esc(r.staff)}`;
      bar+=`<div class="bar resv" style="left:${left}px;width:${w}px" data-tip="${esc(tip)}" onclick="openResvPanel('${r.id}')">🗓 ${esc(r.customer)}</div>`;});
    lines+=`<div class="gline${s.key==='貸出可'?' avail':''}">${bar}</div>`;});
  document.getElementById('viewArea').innerHTML=`<div class="gantt"><div class="glabels">${labels}</div><div class="gscroll"><div class="gtimeline" style="width:${W}px"><div class="today" style="left:${todayX}px"><span class="todaylab">今日</span></div><div class="ghrow">${ticks}</div>${lines}</div></div></div>
    <div class="legend"><span><span class="sw" style="background:linear-gradient(180deg,#3b82f6,#2563eb)"></span>日付指定</span><span><span class="sw" style="background:repeating-linear-gradient(45deg,#a6acbb,#a6acbb 4px,#bcc2cf 4px,#bcc2cf 8px)"></span>未定（→）</span><span><span class="sw" style="border:2px dashed var(--accent);background:#fff"></span>予約</span><span>🟥超過 🟨返却間近 ⚠長期確認</span></div>`;
  bindTips();}
function renderListView(){let rows='';unitsOf(selected).forEach(u=>{const s=statusOf(u),l=u.loan,clk=(s.key==='貸出中'||isHoldS(s.key)||s.key==='出荷待ち');
    const tag=s.alert==='超過'?' 🟥':s.alert==='間近'?' 🟨':s.alert==='長期'?' ⚠':'';
    const cust=l?esc(recip(l)):'－';const ship=(l&&l.shipped)?fmtY(l.ship):'－';
    const due=(l&&!l.returned)?(l.dueType==='日付指定'?fmtY(l.due):l.dueType):'－';
    const el=(l&&l.shipped&&!l.returned)?days(l.ship,TODAY):'';const elTxt=el===''?'－':`<span class="elapsed tnum ${el>90?'long':''}">${el}日</span>`;
    const reqstaff=l?esc(l.reqStaff||'－'):'－';const rstaff=l?esc(l.staff||'－'):'－';const sstaff=l?esc(l.shipStaff||'－'):'－';
    rows+=`<tr class="${clk?'click':''}${s.key==='貸出可'?' avail':''}" ${clk?`onclick="openPanel('${u.id}')"`:''}><td>#${esc(u.sn)} ${typeText(u)}${noteI(u.note)}</td><td><span class="st"><span class="dot ${s.dot}"></span>${s.key}${s.sub?'（'+s.sub+'）':''}${tag}</span></td><td>${cust}</td><td>${ship}</td><td>${due}</td><td>${elTxt}</td><td>${reqstaff}</td><td>${rstaff}</td><td>${sstaff}</td></tr>`;});
  document.getElementById('viewArea').innerHTML=`<table class="list"><thead><tr><th>シリアル</th><th>状態</th><th>貸出先</th><th>出荷日</th><th>返却予定日</th><th>経過日数</th><th>依頼担当</th><th>受付担当</th><th>出荷担当</th></tr></thead><tbody>${rows}</tbody></table>`;bindTips();}

/* 出荷待ち案件（倉庫が「今日何を出すか」を見る）。案件IDでまとめ、単発は貸出ID単位 */
function waitingCases(){const map={};
  units.forEach(u=>{if(statusOf(u).key!=='出荷待ち')return;const l=u.loan,key=l.caseId||('L:'+l.loanId);(map[key]=map[key]||{key:key,loan:l,units:[]}).units.push(u);});
  return Object.values(map).sort((a,b)=>String(a.loan.recvDate).localeCompare(String(b.loan.recvDate)));}
function shipWaitSection(showHeader){const waits=waitingCases();
  const head=showHeader?`<h4 style="margin:4px 0 8px">🚚 出荷待ち一覧<span class="meta" style="font-weight:400">　${waits.length}件</span></h4>`:'';
  return head+`<table class="list"><thead><tr><th>貸出先</th><th>ご担当者</th><th>品目</th><th>付属品</th><th>終了予定</th><th>受付日</th><th>出荷日(予定)</th><th>依頼担当</th><th>受付担当</th></tr></thead><tbody>${waits.length?waits.map(c=>{const l=c.loan,names=[...new Set(c.units.map(u=>prodOf(u.prod).name))].join('、');
   const shipTxt=l.ship?`<span${l.ship<TODAY?' style="color:var(--red);font-weight:700"':''}>${fmtY(l.ship)}</span>`:'－';
   const due=l.dueType==='日付指定'?fmtY(l.due):esc(l.dueType||'－');
   return `<tr class="click" onclick="openShipCase('${c.key}')"><td>${esc(recip(l))}</td><td>${esc(l.ship2||'－')}</td><td>${esc(names)}</td><td>${esc([...new Set(c.units.map(u=>u.loan.attach).filter(Boolean))].join(' / ')||'－')}</td><td>${due}</td><td>${l.recvDate?ymd(l.recvDate):'－'}</td><td>${shipTxt}</td><td>${esc(l.reqStaff||'－')}</td><td>${esc(l.staff||'－')}</td></tr>`;}).join(''):'<tr><td colspan="9" class="note" style="padding:14px">出荷待ちはありません 🎉</td></tr>'}</tbody></table>`;}
let shipCaseKey='';
const isPending=sn=>sn==='（出荷時入力）'||sn==='（自動採番）';   // 在庫一時のシリアル未確定（出荷時に確定）
function openShipCase(key){if(!canField()){alert('出荷確定は事務所・倉庫担当のみ可能です。');return;}const c=waitingCases().find(x=>x.key===key);if(!c)return;const l=c.loan;shipCaseKey=key;
  const rowsHtml=c.units.map((u,i)=>{const pending=isPending(u.sn);
    const serial=pending
      ? `<div class="radios" style="margin-top:2px"><label class="ro"><input type="radio" name="ss${i}" value="real" checked onchange="scSn(${i},'real')"> 実シリアルを入力</label><div id="scReal${i}" class="indent"><input class="needin" id="scRealV${i}" placeholder="例：10150494"></div><label class="ro"><input type="radio" name="ss${i}" value="auto" onchange="scSn(${i},'auto')"> 自動採番（無刻印品）</label><div id="scAuto${i}" class="indent" style="display:none"><input disabled value="${esc(nextAuto(u.prod))}"></div></div>`
      : `<div class="scval">#${esc(u.sn)} ${typeText(u)} <small style="color:var(--muted)">〔登録済・確認のみ〕</small></div>`;
    return `<div class="scitem"><div class="scname">${i+1}. ${esc(prodOf(u.prod).name)} ${pending?'<span class="pill resv">在庫一時</span>':typeText(u)}</div>
      <div class="scfield"><label>シリアル${pending?' <span style="color:var(--red)">＊必須</span>':''}</label>${serial}</div>
      <div class="scfield"><label>付属品・同梱品</label><input class="needin" id="scAtt${i}" value="${esc(u.loan.attach||'')}" placeholder="例：ケース・電池（無ければ空欄でOK）"></div></div>`;
  }).join('');
  document.getElementById('caseCard').innerHTML=`<h3>🚚 出荷確定</h3>
   <div class="msub">${esc(recip(l))}${(l.customer&&l.ship2)?'／ご担当 '+esc(l.ship2):''}　・　受付 ${l.recvDate?ymd(l.recvDate):'－'}（${esc(l.staff||'－')}）　・　終了予定 ${l.dueType==='日付指定'?fmtY(l.due):esc(l.dueType||'－')}</div>
   <div class="scnote">🟩 の欄が倉庫の入力項目です。塗ってある所だけ記入してください（それ以外は受付内容で変更できません）。</div>
   ${rowsHtml}
   ${l.note?`<div class="scref"><label>案件備考（受付）</label><div>${esc(l.note)}</div></div>`:''}
   <div class="mbtns"><button onclick="cls('caseModal')">キャンセル</button>${canOffice()?`<button onclick="cls('caseModal');openEditLoan('${c.units[0].id}')">✎ 案件編集</button>`:''}${canOffice()?`<button onclick="cls('caseModal');openEmpyo('${c.units[0].id}')">🖨 伝票出力</button>`:''}<button class="primary" onclick="doShipCaseConfirm()">確定して出荷（${c.units.length}台）</button></div>`;
  document.getElementById('caseModal').classList.add('show');}
function scSn(i,m){document.getElementById('scReal'+i).style.display=m==='real'?'block':'none';document.getElementById('scAuto'+i).style.display=m==='auto'?'block':'none';}
function doShipCaseConfirm(){const c=waitingCases().find(x=>x.key===shipCaseKey);if(!c)return;const items=[];
  for(let i=0;i<c.units.length;i++){const u=c.units[i],pending=isPending(u.sn);
    const it={loanId:u.loan.loanId,unitId:u.id,attach:val('scAtt'+i),needSerial:pending};
    if(pending){const sm=(document.querySelector('input[name=ss'+i+']:checked')||{}).value||'real';
      if(sm==='real'){const sv=val('scRealV'+i);if(!sv){alert((i+1)+'番目「'+prodOf(u.prod).name+'」のシリアルを入力してください');return;}it.serialType='実シリアル';it.serial=sv;}
      else{it.serialType='自動採番';it.serial='';}}
    items.push(it);}
  (busyOn(),google.script.run).withSuccessHandler(()=>{cls('caseModal');closePanel();reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).shipCaseConfirm({loanId:c.loan.loanId,items:items});}
function renderShipWait(){document.getElementById('main').innerHTML=`<div class="sechead"><h2>出荷待ち一覧</h2><span class="meta">出荷待ちステータスの案件すべて（行クリックで出荷内容を確認・出荷完了）。出荷予定日が過去のものは赤字。</span></div><div style="margin-top:14px">${shipWaitSection(false)}</div>`;bindTips();}
function renderCompleted(){document.getElementById('main').innerHTML=`<div class="sechead"><h2>完了案件</h2><span class="meta">返却・廃棄でアーカイブされた案件（返却日が新しい順）</span></div><div id="cmpArea" style="margin-top:14px" class="note">読み込み中…</div>`;
  google.script.run.withSuccessHandler(renderCompletedList).withFailureHandler(e=>{const el=document.getElementById('cmpArea');if(el)el.textContent='エラー: '+e.message;}).getCompleted();}
function renderCompletedList(rows){const el=document.getElementById('cmpArea');if(!el)return;
  const map={},order=[];
  rows.forEach(r=>{const key=r.caseId||('L:'+r.loanId);if(!map[key]){map[key]={key,items:[],head:r};order.push(key);}map[key].items.push(r);});
  const groups=order.map(k=>map[k]).sort((a,b)=>String(b.head.returned).localeCompare(String(a.head.returned)));
  el.className='';
  el.innerHTML=groups.length?`<table class="list"><thead><tr><th>貸出先</th><th>ご担当者</th><th>品目</th><th>受付日</th><th>出荷日</th><th>返却日</th><th>状態</th><th>依頼担当</th><th>受付担当</th></tr></thead><tbody>${groups.map(g=>{const h=g.head,names=[...new Set(g.items.map(it=>it.prodName).filter(Boolean))].join('、');const st=h.state==='廃棄'?'<span style="color:var(--red);font-weight:700">廃棄</span>':esc(h.proc||h.state||'返却済');return `<tr><td>${esc(h.customer||'－')}</td><td>${esc(h.ship2||'－')}</td><td>${esc(names||'－')}${g.items.length>1?` <span class="badge tnum">${g.items.length}台</span>`:''}</td><td>${ymd(h.recvDate)||'－'}</td><td>${ymd(h.ship)||'－'}</td><td>${ymd(h.returned)||'－'}</td><td>${st}</td><td>${esc(h.reqStaff||'－')}</td><td>${esc(h.staff||'－')}</td></tr>`;}).join('')}</tbody></table>`:'<p class="note">完了案件はまだありません。</p>';}

function renderDashboard(){let total=units.length,avail=0,out=0,ins=0,attw=0;units.forEach(u=>{const s=statusOf(u);if(s.key==='貸出可')avail++;else if(s.key==='検品待ち')ins++;else if(s.key==='付属品待ち')attw++;else out++;});
  const a=alertsIn(units),rate=total?Math.round(out/total*100):0;
  const att=units.map(u=>({u,s:statusOf(u)})).filter(o=>o.s.alert).map(o=>({u:o.u,s:o.s,sev:o.s.alert==='超過'?0:o.s.alert==='間近'?1:2,el:o.u.loan?days(o.u.loan.ship,TODAY):0})).sort((x,y)=>x.sev-y.sev||y.el-x.el);
  const makers={};units.forEach(u=>{const m=prodOf(u.prod).maker;makers[m]=makers[m]||{out:0,t:0};makers[m].t++;if(statusOf(u).key==='貸出中')makers[m].out++;});const upc=[...reservations].sort((p,q)=>p.start-q.start);
  document.getElementById('main').innerHTML=`<div class="sechead"><h2>ダッシュボード</h2><span class="meta">${TODAY.getFullYear()}/${fmt(TODAY)}（本日）</span></div>
    <div class="kpis"><div class="kpi" style="cursor:pointer" onclick="goList('超過')"><div class="lab">🟥 超過</div><div class="val tnum" style="color:var(--red)">${a.over}</div></div><div class="kpi" style="cursor:pointer" onclick="goList('間近')"><div class="lab">🟨 返却間近(7日)</div><div class="val tnum" style="color:var(--amber)">${a.soon}</div></div><div class="kpi" style="cursor:pointer" onclick="goList('長期')"><div class="lab">⚠ 長期確認</div><div class="val tnum" style="color:#c2410c">${a.longg}</div></div></div>
    <div class="kpis"><div class="kpi"><div class="lab">総シリアル数</div><div class="val tnum">${total}</div></div><div class="kpi k-avail" style="cursor:pointer" onclick="goList('貸出可')"><div class="lab">貸出可</div><div class="val tnum">${avail}</div></div><div class="kpi k-out" style="cursor:pointer" onclick="goList('貸出中')"><div class="lab">貸出中</div><div class="val tnum">${out}</div></div><div class="kpi k-hold" style="cursor:pointer" onclick="goList('検品待ち')"><div class="lab">検品待ち</div><div class="val tnum">${ins}</div></div><div class="kpi k-hold" style="cursor:pointer" onclick="goList('付属品待ち')"><div class="lab">付属品待ち</div><div class="val tnum">${attw}</div></div><div class="kpi"><div class="lab">稼働率</div><div class="val tnum" style="color:var(--accent-strong)">${rate}%</div></div></div>
    <div style="margin-top:22px">${shipWaitSection(true)}</div>
    <h4 style="margin:22px 0 8px">要対応（${att.length}件）</h4><table class="list"><thead><tr><th>商品</th><th>シリアル</th><th>状態</th><th>貸出先</th><th>終了予定</th><th>経過</th></tr></thead><tbody>${att.length?att.map(({u,s,el})=>{const l=u.loan,p=prodOf(u.prod),tag=s.alert==='超過'?'🟥 超過':s.alert==='間近'?'🟨 間近':'⚠ 長期',due=l.dueType==='日付指定'?fmtY(l.due):l.dueType;return `<tr class="click" onclick="openPanel('${u.id}')"><td>${esc(p.name)}</td><td>#${esc(u.sn)} ${typeText(u)}</td><td>${tag}</td><td>${esc(recip(l))}</td><td>${due}</td><td><span class="elapsed tnum ${el>90?'long':''}">${el}日</span></td></tr>`;}).join(''):`<tr><td colspan="6" class="note" style="padding:14px">対応が必要な貸出はありません 🎉</td></tr>`}</tbody></table>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px"><div><h4 style="margin:0 0 8px">メーカー別 稼働率</h4><div class="bars card">${Object.keys(makers).sort().map(m=>{const r=Math.round(makers[m].out/makers[m].t*100);return `<div class="brow"><div class="bn">${esc(m)}</div><div class="bt"><div class="bf" style="width:${r}%"></div></div><div class="bp tnum">${r}%</div></div>`;}).join('')||'<div class="note">データなし</div>'}</div></div>
      <div><h4 style="margin:0 0 8px">直近の予約</h4><table class="list"><thead><tr><th>シリアル</th><th>予約先</th><th>期間</th></tr></thead><tbody>${upc.map(r=>{const u=units.find(x=>x.id===r.unit)||{sn:r.unit};return `<tr><td>#${esc(u.sn)} ${typeText(u)}</td><td>${esc(r.customer)}</td><td>${fmt(r.start)}〜${fmt(r.end)}</td></tr>`;}).join('')||'<tr><td colspan="3" class="note" style="padding:12px">予約なし</td></tr>'}</tbody></table></div></div>
    <h4 style="margin:22px 0 8px">分析指標</h4><div class="repgrid" style="max-width:780px"><div class="repcard"><div class="lab">稼働率</div><div class="val tnum">${rate}%</div></div><div class="repcard"><div class="lab">予約件数</div><div class="val tnum">${reservations.length}件</div></div><div class="repcard"><div class="lab">総シリアル数</div><div class="val tnum">${total}</div></div><div class="repcard"><div class="lab">貸出可</div><div class="val tnum">${avail}</div></div></div>`;}

function renderActive(){const f=listFilter,hold=(f==='保留'||f==='検品待ち'||f==='付属品待ち');
  const titles={active:'貸出中リスト（全商品）','超過':'超過の貸出','間近':'返却間近の貸出','長期':'長期確認の貸出','貸出可':'貸出可のシリアル','貸出中':'貸出中のシリアル','保留':'検品/付属品待ちのシリアル','検品待ち':'検品待ちのシリアル','付属品待ち':'付属品待ちのシリアル','出荷待ち':'出荷待ちのシリアル'};
  let arr=units.map(u=>({u,s:statusOf(u)}));
  if(f==='active')arr=arr.filter(o=>o.s.key==='貸出中'||isHoldS(o.s.key)||o.s.key==='出荷待ち');
  else if(f==='保留')arr=arr.filter(o=>isHoldS(o.s.key));
  else if(f==='貸出可'||f==='貸出中'||f==='出荷待ち'||f==='検品待ち'||f==='付属品待ち')arr=arr.filter(o=>o.s.key===f);
  else arr=arr.filter(o=>o.s.alert===f);
  const rows=arr.map(o=>{const u=o.u,l=u.loan,p=prodOf(u.prod),el=(l&&l.shipped)?days(l.ship,TODAY):'';return{u,l,p,s:o.s,el};}).sort((a,b)=>(b.el===''?-1:b.el)-(a.el===''?-1:a.el));
  const head=hold
    ? `<th>商品</th><th>シリアル</th><th>状態</th><th>貸出先</th><th>出荷日</th><th>返却確認日</th><th>経過</th><th>依頼担当</th><th>受付担当</th><th>出荷担当</th><th>着荷確認担当</th>`
    : `<th>商品</th><th>シリアル</th><th>状態</th><th>貸出先</th><th>出荷日</th><th>終了予定</th><th>経過</th><th>依頼担当</th><th>受付担当</th><th>出荷担当</th>`;
  const body=rows.map(({u,l,p,s,el})=>{const tag=s.alert==='超過'?' 🟥':s.alert==='間近'?' 🟨':s.alert==='長期'?' ⚠':'';const clk=(s.key==='貸出中'||isHoldS(s.key)||s.key==='出荷待ち');
    const cust=l?esc(recip(l)):'－';const ship=(l&&l.shipped)?fmtY(l.ship):'－';const elTxt=el===''?'－':`<span class="elapsed tnum ${el>90?'long':''}">${el}日</span>`;
    const reqstaff=l?esc(l.reqStaff||'－'):'－';const rstaff=l?esc(l.staff||'－'):'－';const sstaff=l?esc(l.shipStaff||'－'):'－';
    const stCell=`<td><span class="st"><span class="dot ${s.dot}"></span>${s.key}${s.sub?'('+s.sub+')':''}${tag}</span></td>`;
    const tr=`<tr class="${clk?'click':''}" ${clk?`onclick="openPanel('${u.id}')"`:''}>`;
    if(hold){const rconf=l?fmtY(l.returned):'－';const cstaff=l?esc(l.recvStaff||'－'):'－';
      return `${tr}<td>${esc(p.name)}</td><td>#${esc(u.sn)} ${typeText(u)}${noteI(u.note)}</td>${stCell}<td>${cust}</td><td>${ship}</td><td>${rconf}</td><td>${elTxt}</td><td>${reqstaff}</td><td>${rstaff}</td><td>${sstaff}</td><td>${cstaff}</td></tr>`;}
    const due=(l&&!l.returned)?(l.dueType==='日付指定'?fmtY(l.due):l.dueType):'－';
    return `${tr}<td>${esc(p.name)}</td><td>#${esc(u.sn)} ${typeText(u)}${noteI(u.note)}</td>${stCell}<td>${cust}</td><td>${ship}</td><td>${due}</td><td>${elTxt}</td><td>${reqstaff}</td><td>${rstaff}</td><td>${sstaff}</td></tr>`;
  }).join('')||`<tr><td colspan="${hold?11:10}" class="note" style="padding:14px">該当なし</td></tr>`;
  document.getElementById('main').innerHTML=`<div class="sechead"><h2>${titles[f]||'一覧'}</h2><span class="meta">${rows.length}件</span>${f!=='active'?`<span class="pAlerts"><button class="btn" onclick="goList('active')">← 貸出中リストへ</button></span>`:''}</div>
    <div class="toolbar"><span class="meta">経過日数の長い順。行クリックで詳細。</span></div>
    <table class="list"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;bindTips();}

function renderReserve(){document.getElementById('main').innerHTML=`<div class="sechead"><h2>予約</h2><span class="meta">シリアル単位の将来予約 ${reservations.length}件</span></div>
  <div class="toolbar"><span class="meta">キャンセルの場合は該当商品をクリックしてください。</span><span class="spacer"></span>${canOffice()?`<button class="btn primary" onclick="openResv('')">🗓 新規予約</button>`:''}</div>
  <table class="list"><thead><tr><th>商品 / シリアル</th><th>予約先 / 用途</th><th>出荷予定日</th><th>返却着荷予定日</th><th>受付</th><th></th></tr></thead><tbody>${resvGroups().map(g=>{const lines=g.items.map(it=>{const u=units.find(x=>x.id===it.unit)||{sn:it.unit,prod:''};return esc(prodOf(u.prod).name)+' #'+esc(u.sn)+' '+typeText(u);}).join('<br>');return `<tr><td>${lines}${g.items.length>1?` <span class="badge tnum">${g.items.length}台</span>`:''}</td><td><span class="pill resv">🗓</span> ${esc(g.customer)}</td><td>${fmt(g.start)}</td><td>${fmt(g.end)}</td><td>${esc(g.staff)}</td><td>${canOffice()?`<button class="btn" onclick="doCancelResv('${g.items[0].id}','${g.caseId}')">キャンセル</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="6" class="note" style="padding:12px">予約なし</td></tr>'}</tbody></table>`;}
/* 予約を案件IDでグルーピング（案件IDが無ければ予約単独） */
function resvGroups(){const map={},order=[];reservations.forEach(r=>{const key=r.caseId||('R:'+r.id);if(!map[key]){map[key]={caseId:r.caseId||'',customer:r.customer,start:r.start,end:r.end,staff:r.staff,items:[]};order.push(key);}map[key].items.push(r);});return order.map(k=>map[k]);}

/* ===== 商品登録（タブ） ===== */
let urTab='exist',urSelCode='';
function renderUnitReg(){document.getElementById('main').innerHTML=`<div class="sechead"><h2>商品登録</h2><span class="meta">在庫から供出 / サンプル作成 → シリアルに追加</span></div>
  <div class="tabs" style="margin-top:16px"><button class="tab ${urTab==='exist'?'on':''}" onclick="urSetTab('exist')">既存商品にシリアル追加</button><button class="tab ${urTab==='new'?'on':''}" onclick="urSetTab('new')">＋ 新商品を登録</button></div>
  <div class="card" style="border-radius:0 11px 11px 11px">${urTab==='exist'?urExist():urNew()}</div>${urTab==='exist'?`<h4 style="margin:20px 0 8px">登録済みシリアル</h4><div id="urList"></div>`:''}`;
  if(urTab==='exist')urRenderList(urSelCode);else urCatOpts();}
function urSetTab(t){urTab=t;renderUnitReg();}
function urExist(){const autoVal=nextAuto(urSelCode);
  return `<label class="lab2">商品を検索して選択</label><div class="combo"><input id="urSearch" placeholder="🔍 品名・品番で検索" value="${urSelCode?esc(prodOf(urSelCode).name):''}" oninput="urFilter()" onfocus="urFilter()" onblur="setTimeout(()=>{var c=document.getElementById('urCombo');if(c)c.style.display='none'},150)" autocomplete="off"><div class="combo-list" id="urCombo"></div></div>
  <div class="formgrid" style="margin-top:16px"><div class="full"><label>シリアルの付け方</label><div class="radios">
    <label class="ro"><input type="radio" name="snmode" checked onchange="urSn('real')"> 実シリアルを入力</label><div id="urRealWrap" class="indent"><input id="urReal" placeholder="例：10150494"></div>
    <label class="ro"><input type="radio" name="snmode" onchange="urSn('auto')"> 自動採番（無刻印品）</label><div id="urAutoWrap" class="indent" style="display:none"><input id="urAuto" disabled value="${autoVal}"></div></div></div>
    <div><label>種別（商品ステータス）</label><select id="urKind" onchange="urMgmtPrev()"><option>在庫</option><option selected>サンプル</option><option>サンプル在庫</option></select></div><div><label>由来</label><select id="urOrigin"><option>在庫から</option><option selected>最初からサンプル</option></select></div><div><label>運用開始日</label><input id="urStart" type="date" value="${fmtISO(TODAY)}"></div><div><label>管理番号（自動）</label><input id="urMgmt" disabled value="${nextMgmt(urSelCode,'サンプル')}"></div><div class="full"><label>備考</label><input id="urNote"></div></div>
  <div class="mbtns"><button class="btn primary" onclick="submitUnit()">シリアルを登録</button></div>`;}
function urNew(){return `<div class="note" style="margin:0 0 12px;color:var(--accent-strong)">メーカーを選ぶとカテゴリが絞り込まれます（M_メーカーカテゴリ）。</div>
  <div class="formgrid"><div><label>品番</label><input id="npCode" placeholder="例：SIONYX-PRO"></div><div><label>品名</label><input id="npName" placeholder="例：サイオニクスオーロラプロ"></div>
  <div><label>メーカー</label><select id="urMaker" onchange="urCatOpts()">${Object.keys(makerCat).sort().map(m=>`<option>${esc(m)}</option>`).join('')}</select></div><div><label>カテゴリ（メーカーで絞込）</label><select id="urCat"></select></div></div>
  <div class="mbtns"><button class="btn primary" onclick="submitProduct()">この商品を登録</button></div>`;}
function urCatOpts(){const m=document.getElementById('urMaker');if(!m)return;document.getElementById('urCat').innerHTML=(makerCat[m.value]||[]).map(c=>`<option>${esc(c)}</option>`).join('');}
function urFilter(){const q=document.getElementById('urSearch').value.trim().toLowerCase(),res=products.filter(p=>(p.name+p.code+p.maker+p.cat).toLowerCase().includes(q)).slice(0,8),box=document.getElementById('urCombo');box.innerHTML=res.length?res.map(p=>`<div class="ci" onmousedown="urPick('${p.code}')"><b>${esc(p.name)}</b> <span style="color:var(--muted)">${esc(p.maker)} / ${esc(p.cat)}</span></div>`).join(''):'<div class="ci" style="color:var(--muted)">該当なし</div>';box.style.display='block';}
function urMgmtPrev(){const e=document.getElementById('urMgmt');if(e)e.value=nextMgmt(urSelCode,val('urKind'));}
function urPick(c){urSelCode=c;document.getElementById('urSearch').value=prodOf(c).name;document.getElementById('urCombo').style.display='none';const a=document.getElementById('urAuto');if(a)a.value=nextAuto(c);urMgmtPrev();urRenderList(c);}
function urSn(m){document.getElementById('urRealWrap').style.display=m==='real'?'block':'none';document.getElementById('urAutoWrap').style.display=m==='auto'?'block':'none';}
function urRenderList(code){const el=document.getElementById('urList');if(!el)return;if(!code){el.innerHTML='<p class="note">商品を選ぶと、その商品の登録済みシリアルが表示されます。</p>';return;}const list=unitsOf(code);
  el.innerHTML=`<table class="list"><thead><tr><th>商品</th><th>シリアル</th><th>管理番号</th><th>運用開始日</th><th>備考</th><th>状態</th><th></th></tr></thead><tbody>${list.map(u=>{const s=statusOf(u);return `<tr><td>${esc(prodOf(u.prod).name)}</td><td>#${esc(u.sn)} ${typeText(u)}</td><td>${typeText(u)}</td><td>${esc(u.start||'－')}</td><td>${esc(u.note||'－')} <button class="btn" style="padding:3px 7px;font-size:11px" onclick="editUnitNote('${u.id}')" title="備考を編集">✎</button></td><td><span class="st"><span class="dot ${s.dot}"></span>${s.key}</span></td><td>${canOffice()?`<button class="btn" onclick="openDiscard('${u.id}')">廃棄</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="7" class="note" style="padding:12px">まだシリアルがありません</td></tr>'}</tbody></table>`;}

function renderUsers(){document.getElementById('main').innerHTML=`<div class="sechead"><h2>ユーザー登録</h2><span class="meta">Googleアカウント↔漢字氏名・役割</span></div>
  <table class="list"><thead><tr><th>メール</th><th>氏名(漢字)</th><th>役割</th><th>有効</th></tr></thead><tbody>${usersData.map(u=>`<tr><td>${u.mail||'<span style="color:#cbd5e1">（未登録）</span>'}</td><td>${esc(u.name)}</td><td><span class="rolebadge r-${u.role}">${esc(u.role)}</span></td><td>${u.on?'✓':'－'}</td></tr>`).join('')}</tbody></table>
  <div class="card" style="margin-top:18px"><h4 style="margin:0 0 10px">＋ 新規ユーザー</h4><div class="formgrid"><div><label>メール</label><input id="uMail" placeholder="x.yamada@example.com"></div><div><label>役割</label><select id="uRole"><option>事務所</option><option>倉庫</option><option>閲覧</option></select></div><div><label>姓（漢字）</label><input id="uLast" placeholder="山田"></div><div><label>名（漢字）</label><input id="uFirst" placeholder="太郎"></div></div><div class="mbtns"><button class="btn primary" onclick="submitUser()">追加</button></div></div>`;}

function renderSettings(){document.getElementById('main').innerHTML=`<div class="sechead"><h2>設定・通知</h2><span class="meta">超過アラートメール</span></div>
  <div class="card" style="margin-top:16px"><div id="alertStatus" class="note">状態を確認中…</div>
   <div class="formgrid" style="max-width:640px;margin-top:10px"><div class="full"><label>動作内容</label><div class="v" style="font-size:13px;line-height:1.8">毎日1回 T_貸出 を確認し、<b>終了予定日（日付指定）から5日経過</b>しても貸出中（返却処理されていない）案件があれば、<b>受付担当・出荷担当</b>へメール送信します。さらに<b>15日経過</b>で再送し、その後は送りません。返却されずに同じ案件IDが続く間だけが対象です（返却→別の場所へ貸出は別案件になり対象外）。</div></div>
   <div class="full"><label>宛先の解決</label><div class="v" style="font-size:13px">受付担当・出荷担当の氏名から M_ユーザー のメールを引きます。未登録の担当がいる場合は管理者へフォールバックします。</div></div></div>
   <div class="mbtns" style="justify-content:flex-start"><button class="btn primary" onclick="enableAlert()">アラートを有効化（日次トリガー設置）</button><button class="btn" onclick="disableAlert()">無効化</button><button class="btn" onclick="testAlert()">今すぐ判定して送信（テスト）</button></div>
   <p class="note">「有効化」を押すと毎朝の自動チェック（GAS時限トリガー）が設置されます。初回はGoogleの権限承認が必要です。「テスト」は現時点で対象がある場合に実際のメールを送信します。</p></div>
  <div class="sechead" style="margin-top:24px"><h2>Googleチャット通知</h2><span class="meta">新規受付の登録時</span></div>
  <div class="card" style="margin-top:16px"><div id="chatStatus" class="note">状態を確認中…</div>
   <div class="formgrid" style="max-width:640px;margin-top:10px"><div class="full"><label>動作内容</label><div class="v" style="font-size:13px;line-height:1.8"><b>新規受付が登録された瞬間</b>に、貸出先・受付担当・対象機をGoogleチャットへ通知します。チャットスペースで作成した<b>Incoming WebフックのURL</b>を下に貼り付けて保存してください。空欄で保存すると通知OFFになります。</div></div>
   <div class="full"><label>WebフックURL</label><input id="chatUrl" type="text" placeholder="https://chat.googleapis.com/v1/spaces/..."></div></div>
   <div class="mbtns" style="justify-content:flex-start"><button class="btn primary" onclick="saveChat()">保存</button><button class="btn" onclick="testChat()">テスト送信</button></div>
   <p class="note">WebフックURLは秘匿情報です（知っている人は誰でも投稿できます）。保存後は安全のため画面に再表示しません。初回送信時はGoogleの権限承認（外部リクエスト）が必要です。</p></div>`;
  refreshAlertStatus();refreshChatStatus();}
function refreshChatStatus(){google.script.run.withSuccessHandler(s=>{const el=document.getElementById('chatStatus');if(!el)return;el.innerHTML=s.enabled?'<span class="st"><span class="dot green"></span><b>有効</b>：新規受付の登録時にチャット通知します。</span>':'<span class="st"><span class="dot red"></span><b>無効</b>：WebフックURLが未設定です。</span>';}).withFailureHandler(e=>{const el=document.getElementById('chatStatus');if(el)el.textContent='状態取得エラー: '+e.message;}).chatWebhookStatus();}
function saveChat(){const url=document.getElementById('chatUrl').value.trim();busyOn();google.script.run.withSuccessHandler(r=>{busyOff();alert(r.enabled?'WebフックURLを保存しました（通知ON）':'URLを消去しました（通知OFF）');document.getElementById('chatUrl').value='';refreshChatStatus();}).withFailureHandler(e=>{busyOff();alert(e.message)}).setChatWebhook(url);}
function testChat(){busyOn();google.script.run.withSuccessHandler(r=>{busyOff();alert(r.ok?'テスト通知を送信しました。チャットを確認してください。':'送信できませんでした。WebフックURLが未設定か、URLが無効です。');}).withFailureHandler(e=>{busyOff();alert(e.message)}).sendChatTest();}
function refreshAlertStatus(){google.script.run.withSuccessHandler(s=>{const el=document.getElementById('alertStatus');if(!el)return;el.innerHTML=s.enabled?'<span class="st"><span class="dot green"></span><b>有効</b>：毎日の自動チェックが動作中です。</span>':'<span class="st"><span class="dot red"></span><b>無効</b>：自動チェックは設置されていません。</span>';}).withFailureHandler(e=>{const el=document.getElementById('alertStatus');if(el)el.textContent='状態取得エラー: '+e.message;}).overdueAlertStatus();}
function enableAlert(){busyOn();google.script.run.withSuccessHandler(()=>{busyOff();alert('アラートを有効化しました（毎日自動チェック）');refreshAlertStatus();}).withFailureHandler(e=>{busyOff();alert(e.message)}).installOverdueTrigger();}
function disableAlert(){busyOn();google.script.run.withSuccessHandler(()=>{busyOff();alert('アラートを無効化しました');refreshAlertStatus();}).withFailureHandler(e=>{busyOff();alert(e.message)}).removeOverdueTrigger();}
function testAlert(){if(!confirm('現時点で対象となる案件があれば、実際にメールを送信します。よろしいですか？'))return;busyOn();google.script.run.withSuccessHandler(r=>{busyOff();alert(r.sent?(r.sent+'件のアラートを送信しました'):'対象となる案件はありませんでした');}).withFailureHandler(e=>{busyOff();alert(e.message)}).checkOverdueAlerts();}

/* ===== tooltip / パネル ===== */
function bindTips(){document.querySelectorAll('.bar[data-tip],.ni[data-tip]').forEach(b=>{b.addEventListener('mouseenter',()=>{const t=document.getElementById('tip');if(b.classList.contains('ni'))t.textContent=b.dataset.tip;else t.innerHTML=b.dataset.tip;t.style.display='block';});b.addEventListener('mousemove',e=>{const t=document.getElementById('tip');t.style.left=Math.min(e.clientX+14,innerWidth-310)+'px';t.style.top=(e.clientY+16)+'px';});b.addEventListener('mouseleave',()=>document.getElementById('tip').style.display='none');});}
let curUnit='';
function openPanelView(uid){const u=units.find(x=>x.id===uid);if(!u||!u.loan)throw new Error('stale');const l=u.loan,s=statusOf(u),p=prodOf(u.prod),hold=isHoldS(s.key),wait=s.key==='出荷待ち';curUnit=uid;
  const due=l.dueType==='日付指定'?fmtY(l.due)+'（日付指定）':l.dueType;
  document.getElementById('panelTitle').textContent=`#${u.sn} ${typeText(u)}　${p.name}`;
  document.getElementById('panelBody').innerHTML=`<div class="field"><div class="l">状態</div><div class="v"><span class="st"><span class="dot ${s.dot}"></span>${s.key}${s.alert?'（'+s.alert+'）':''}</span></div></div>
    ${l.customer?`<div class="field"><div class="l">会社名</div><div class="v">${esc(l.customer)}</div></div>`:''}<div class="field"><div class="l">ご担当者</div><div class="v">${esc(l.ship2||'－')}</div></div>
    ${l.requester?`<div class="field"><div class="l">ご依頼主</div><div class="v">${esc(l.requester)}</div></div>`:''}
    <div class="row2"><div class="field"><div class="l">出荷日</div><div class="v">${l.shipped?fmtY(l.ship):'未出荷'}</div></div><div class="field"><div class="l">${hold?'返却確認日':'経過'}</div><div class="v">${hold?fmtY(l.returned):(l.shipped?days(l.ship,TODAY)+'日':'－')}</div></div></div>
    ${wait?'':`<div class="field"><div class="l">終了予定</div><div class="v">${due}</div></div>`}
    <div class="field"><div class="l">依頼担当</div><div class="v">${esc(l.reqStaff||'－')}</div></div>
    <div class="field"><div class="l">受付担当</div><div class="v">${esc(l.staff||'－')}</div></div>
    ${l.shipped?`<div class="field"><div class="l">出荷担当</div><div class="v">${esc(l.shipStaff||'－')}</div></div>`:''}
    ${hold?`<div class="field"><div class="l">着荷確認担当</div><div class="v">${esc(l.recvStaff||'－')}</div></div>`:''}
    <div class="field"><div class="l">運用開始日</div><div class="v">${esc(u.start||'－')}</div></div>
    <div class="field"><div class="l">付属品</div><div class="v">${esc(l.attach||'－')}</div></div>`;
  const isSample=u.type==='サンプル',isTemp=u.origin==='在庫から（一時）',dis=canOffice()?`<button class="danger" onclick="openDiscard('${u.id}')">廃棄(破損)</button>`:'',del=canOffice()?`<button class="danger" onclick="doDeleteLoan('${l.loanId}')">貸出取消</button>`:'',edit=canOffice()?`<button onclick="openEditLoan('${u.id}')">編集</button>`:'';
  if(wait){const wkey=l.caseId||('L:'+l.loanId);document.getElementById('panelActions').innerHTML=`${canField()?`<button class="primary" onclick="openShipCase('${wkey}')">🚚 出荷確定…</button>`:''}${canOffice()?`<button onclick="openEmpyo('${u.id}')">伝票出力</button>`:''}${edit}${del}`;}
  else if(hold){const rb=isTemp?`<button class="primary" onclick="doResolve('${u.id}','在庫へ戻す')">在庫に戻す</button><button onclick="doResolve('${u.id}','サンプル化')">サンプルに落とす</button>`:`<button class="primary" onclick="doResolve('${u.id}','貸出可能')">貸出可にする</button>`;document.getElementById('panelActions').innerHTML=(canField()?rb:'')+edit+dis;}
  else{const opts=isTemp?[{v:'在庫へ戻す',l:'在庫に戻す'},{v:'サンプル化',l:'サンプルに落とす'},{v:'検品待ち',l:'検品待ち'},{v:'付属品待ち',l:'付属品待ち'}]:[{v:'貸出可能',l:'貸出可能（検品完了）'},{v:'検品待ち',l:'検品待ち'},{v:'付属品待ち',l:'付属品待ち'}];
    const retUI=canField()?`<div style="display:flex;gap:8px;width:100%"><select id="retSel" style="flex:1"><option value="">返却処理を選択…</option>${opts.map(o=>`<option value="${o.v}">${o.l}</option>`).join('')}</select><button class="primary" style="flex:0 0 auto" onclick="confirmReturn()">確定</button></div>`:'';
    document.getElementById('panelActions').innerHTML=`${retUI}${canOffice()?`<button onclick="openExtend('${u.id}')">延長</button>`:''}${canOffice()?`<button onclick="openEmpyo('${u.id}')">伝票出力</button>`:''}${edit}${dis}${del}`;}
  document.getElementById('panelActions').innerHTML+='<button onclick="closePanel()">閉じる</button>';
  showPanel();}
// 個体情報パネル（ガントのラベルクリック）。参照＋備考編集（事務所のみ）。
function openUnitPanelView(uid){const u=units.find(x=>x.id===uid);if(!u)throw new Error('stale');const s=statusOf(u),p=prodOf(u.prod),l=u.loan,onLoan=l&&!l.returned;
  document.getElementById('panelTitle').textContent=`#${u.sn}　${p.name}`;
  document.getElementById('panelBody').innerHTML=`<div class="field"><div class="l">状態</div><div class="v"><span class="st"><span class="dot ${s.dot}"></span>${s.key}${s.sub?'（'+s.sub+'）':''}</span></div></div>
    ${onLoan?`<div class="field"><div class="l">貸出先</div><div class="v">${esc(recip(l))}</div></div><div class="field"><div class="l">依頼担当</div><div class="v">${esc(l.reqStaff||'－')}</div></div>`:''}
    <div class="field"><div class="l">商品</div><div class="v">${esc(p.name)}（${esc(p.code)}）</div></div>
    <div class="field"><div class="l">シリアル</div><div class="v">#${esc(u.sn)}</div></div>
    <div class="field"><div class="l">管理番号</div><div class="v">${typeText(u)}</div></div>
    <div class="field"><div class="l">備考</div><div class="v">${esc(u.note||'－')}</div></div>`;
  document.getElementById('panelActions').innerHTML=`${canOffice()?`<button class="primary" onclick="editUnitNote('${u.id}')">備考を編集</button>`:''}<button onclick="closePanel()">閉じる</button>`;
  showPanel();}
function openResvPanelView(rid){const r=reservations.find(x=>x.id===rid);if(!r)throw new Error('stale');const u=units.find(x=>x.id===r.unit)||{sn:r.unit,prod:''},p=prodOf(u.prod);
  document.getElementById('panelTitle').textContent=`🗓 予約　#${u.sn}`;
  document.getElementById('panelBody').innerHTML=`<div class="field"><div class="l">商品</div><div class="v">${esc(p.name)}</div></div><div class="field"><div class="l">予約先 / 用途</div><div class="v">${esc(r.customer)}</div></div><div class="row2"><div class="field"><div class="l">出荷予定日</div><div class="v">${fmt(r.start)}</div></div><div class="field"><div class="l">返却着荷予定日</div><div class="v">${fmt(r.end)}</div></div></div><div class="field"><div class="l">受付担当</div><div class="v">${esc(r.staff)}</div></div>`;
  document.getElementById('panelActions').innerHTML=`<button class="danger" onclick="doCancelResv('${r.id}')">予約キャンセル</button>`;showPanel();}
function showPanel(){document.getElementById('overlay').classList.add('show');document.getElementById('panel').classList.add('show');}
function hidePanel(){document.getElementById('overlay').classList.remove('show');document.getElementById('panel').classList.remove('show');}
function closePanel(){hidePanel();_detail=null;if(location.search)history.replaceState(null,'',pathSeg());}   // パネルを閉じてURLから?panelを除去（履歴は汚さない）

/* ===== 書き込みアクション ===== */
function confirmReturn(){const v=document.getElementById('retSel').value;if(!v){alert('返却処理を選択してください');return;}const u=units.find(x=>x.id===curUnit);
  (busyOn(),google.script.run).withSuccessHandler(()=>{closePanel();reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).returnLoan(u.loan.loanId,v,fmtISO(TODAY));}
function doResolve(uid,proc){(busyOn(),google.script.run).withSuccessHandler(()=>{closePanel();reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).resolveHold(uid,proc);}
function openDiscard(uid){const u=units.find(x=>x.id===uid),p=prodOf(u.prod);closePanel();
  document.getElementById('discardCard').innerHTML=`<h3>廃棄（マスタから非表示）</h3><div class="msub">#${u.sn} ${typeText(u)}　${esc(p.name)}</div>
   <p style="font-size:13px;line-height:1.7">このシリアルを廃棄します。マスタ一覧から<b>非表示（アーカイブ）</b>になります。履歴は残ります。</p>
   <div class="mbtns"><button onclick="cls('discardModal')">キャンセル</button><button class="primary" onclick="doDiscard('${uid}')">廃棄する</button></div>`;
  document.getElementById('discardModal').classList.add('show');}
function doDiscard(uid){(busyOn(),google.script.run).withSuccessHandler(()=>{cls('discardModal');reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).discardUnit(uid);}
function doDeleteLoan(loanId){if(!confirm('この貸出レコードを削除（取消）します。よろしいですか？'))return;(busyOn(),google.script.run).withSuccessHandler(()=>{closePanel();reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).deleteLoan(loanId);}
function busyOn(){const b=document.getElementById('busy');if(b)b.classList.add('show');}
function busyOff(){const b=document.getElementById('busy');if(b)b.classList.remove('show');}

/* 延長 */
function openExtend(uid){const u=units.find(x=>x.id===uid),l=u.loan;closePanel();
  document.getElementById('extCard').innerHTML=`<h3>貸出期間の延長・変更</h3><div class="msub">#${esc(u.sn)} ${typeText(u)}　${esc(prodOf(u.prod).name)}</div>
   <div class="formgrid"><div><label>終了予定区分</label><select id="exType" onchange="document.getElementById('exDueWrap').style.display=this.value==='日付指定'?'block':'none'">${['日付指定','長期未定','試用完了まで','修理完了まで'].map(o=>`<option ${o===l.dueType?'selected':''}>${o}</option>`).join('')}</select></div><div id="exDueWrap" style="${l.dueType==='日付指定'?'':'display:none'}"><label>新しい終了予定日</label><input id="exDue" type="date" value="${l.due?fmtISO(l.due):''}"></div></div>
   <div class="mbtns"><button onclick="cls('extModal')">キャンセル</button><button class="primary" onclick="submitExtend('${l.loanId}')">更新する</button></div>`;
  document.getElementById('extModal').classList.add('show');}
function submitExtend(loanId){const t=val('exType'),d=val('exDue');if(t==='日付指定'&&!d){alert('終了予定日を入力してください');return;}
  (busyOn(),google.script.run).withSuccessHandler(()=>{cls('extModal');reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).extendLoan(loanId,t,d);}

/* 貸出内容の編集 → 共通フォーム（edit）。案件まるごと・明細の追加/削除（未出荷のみ）対応 */
function openEditLoan(uid){closePanel();openForm('edit',uid);}

/* 伝票出力（貸出伝票・受領書・委託控） */
const COMPANY={addr:'〒530-0012 大阪市北区芝田2-5-6 ニュー共栄ビル',tel:'TEL 06-6371-8548',fax:'FAX 06-6371-8516'};
let empyoUid='',empyoExtra='';
function openEmpyo(uid){empyoUid=uid;empyoExtra='';const ei=document.getElementById('empyoExtra');if(ei)ei.value='';renderEmpyo();document.getElementById('empyoModal').classList.add('show');}
function renderEmpyo(){const u0=units.find(x=>x.id===empyoUid),l=u0.loan;
  const group=l.caseId?units.filter(u=>u.loan&&u.loan.caseId===l.caseId):[u0];   // 同一案件IDをまとめる
  const items=group.map(u=>({name:prodOf(u.prod).name,sn:u.sn,type:u.type,mgmt:u.mgmt?u.type+circNo(parseInt(u.mgmt,10)):'',itemNote:(u.loan&&u.loan.itemNote)||'',attach:(u.loan&&u.loan.attach)||''}));
  const period=l.dueType==='日付指定'?fmtY(l.due)+' まで':l.dueType;
  document.getElementById('empyoArea').innerHTML=['貸出伝票','受領書','委託伝票控'].map(t=>empyoPart(t,items,l,period)).join('<div class="cutline">✂ - - - - - - - - - - - - - きりとり線 - - - - - - - - - - - - -</div>');}
function empyoPart(t,items,l,period){const isRecv=t==='受領書';
  const rows=items.map(it=>`<tr><td>${esc(it.name)}${it.sn&&!isPending(it.sn)?'（#'+esc(it.sn)+'）':''}</td><td>${esc(it.attach||'－')}</td><td>${esc(it.itemNote||'－')}</td><td style="text-align:center">${esc(it.mgmt||'')}</td></tr>`).join('');
  return `<div class="empyo"><div class="e-head"><div class="e-title">${t}</div><div class="e-date">${fmtY(l.ship||TODAY)}</div></div>
   ${l.customer?`<div class="e-to">${esc(l.customer)}</div>`:''}<div class="e-to">${esc(l.ship2||'')}　様</div>
   ${l.requester?`<div class="e-direct">ご依頼主：${esc(l.requester)}</div>`:''}
   <table class="e-tbl"><thead><tr><th>品名</th><th style="width:150px">同梱品</th><th style="width:150px">備考</th><th style="width:90px">管理番号</th></tr></thead><tbody>${rows}</tbody></table>
   <div class="e-period">貸出期間：${period}</div>
   ${l.note?`<div class="e-period">備考：${esc(l.note)}</div>`:''}
   ${empyoExtra?`<div class="e-period">同梱・追記：${esc(empyoExtra)}</div>`:''}
   <div class="e-foot"><div>${isRecv?'下記の通り受領致しました。':'下記の通りお預け致します。'}${isRecv?'<div class="e-seal">受領印</div>':''}</div><div class="e-comp">株式会社 阪神交易<br>${COMPANY.addr}<br>${COMPANY.tel}　${COMPANY.fax}<br>担当者：${esc((l.staff||'').split(' ')[0])}</div></div></div>`;}
function printEmpyo(){document.getElementById('printRoot').innerHTML=document.getElementById('empyoArea').innerHTML;window.print();}

function cls(id){document.getElementById(id).classList.remove('show');}
function fmtISO(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}

/* ===== 共通フォーム（新規貸出 / 予約 / 編集を1つのUIに。保存時のみ分岐） ===== */
let formMode='new',formEditLoanId='',formInit={},nfSrc='exist',nfCode='',nfItems=[];
function openNew(){openForm('new',section==='search'?selected:'');}   // 商品検索からはその商品／それ以外は空白
function openForm(mode,ctx){if(!canOffice()){alert('受付・予約・編集は事務所担当のみ可能です。');return;}formMode=mode;formEditLoanId='';formInit={};nfSrc='exist';nfCode='';nfItems=[];
  if(mode==='edit'){const u=units.find(x=>x.id===ctx),l=u.loan;formEditLoanId=l.loanId;formInit=l;
    const grp=l.caseId?units.filter(x=>x.loan&&x.loan.caseId===l.caseId):[u];
    nfItems=grp.map(x=>({prod:x.prod,name:prodOf(x.prod).name,mode:'exist',unitId:x.id,sn:x.sn,type:x.type,attach:x.loan.attach||'',itemNote:x.loan.itemNote||'',unitNote:x.note||'',loanId:x.loan.loanId,shipped:!!x.loan.shipped}));}
  else{nfCode=(mode==='reserve'?(ctx||selected||''):(ctx||''));}
  renderForm();const mc=document.getElementById('newCard');if(mc)mc.scrollTop=0;document.getElementById('newModal').classList.add('show');}
function renderForm(){const m=formMode,i=formInit||{},isResv=m==='reserve',isEdit=m==='edit';
  const title=isResv?'🗓 新規予約':isEdit?'貸出内容の編集':'＋ 新規貸出';
  const sub=isResv?'シリアル単位で将来の期間を押さえます（複数可）。':isEdit?'この案件の明細・共通項目を編集します。出荷済みの明細は固定（削除不可）。':'事務所が受付登録 → 倉庫が出荷。複数シリアルを1案件（1枚の帳票）にできます。';
  const vendor=(m==='new')?`<label class="lab2">貸出元</label><div class="radios" style="margin-bottom:10px"><label class="ro"><input type="radio" name="nfsrc" ${nfSrc==='exist'?'checked':''} onchange="setNfSrc('exist')"> 登録済みのデモ機から貸す（サンプル等）</label><label class="ro"><input type="radio" name="nfsrc" ${nfSrc==='stock'?'checked':''} onchange="setNfSrc('stock')"> 在庫から新規に出す（その場でシリアル登録＝一時貸出）</label></div>`:'';
  const addArea=`<div class="formgrid" style="margin-bottom:4px"><div class="full"><label>商品を追加</label><div class="combo"><input id="nfSearch" placeholder="🔍 品名・品番で検索" oninput="nfFilter()" onfocus="nfFilter()" onblur="setTimeout(()=>{var c=document.getElementById('nfCombo');if(c)c.style.display='none'},150)" autocomplete="off"><div class="combo-list" id="nfCombo"></div></div></div>
   <div class="full" id="nfSerialArea"></div>
   <div><label>付属品・同梱品</label><input id="nfItemAttach" placeholder="例：ケース・電池・SDカード"></div><div><label>明細備考（帳票の備考欄に印字）</label><input id="nfItemNote" placeholder="例：レンズに小キズ"></div></div>
   <div class="mbtns" style="justify-content:flex-start;margin-top:0"><button class="btn" onclick="addItem()">＋ 明細に追加</button></div>`;
  let meta;
  if(isResv){meta=`<div class="full"><label>予約先 / 用途 <span style="color:var(--red)">＊</span></label><input id="nfCustomer" placeholder="例：○○展示会 / ㈱○○様"></div>
   <div><label>出荷予定日 <span style="color:var(--red)">＊</span></label><input id="nfStart" type="date"></div><div><label>返却着荷予定日 <span style="color:var(--red)">＊</span></label><input id="nfEnd" type="date"></div>
   <div><label>受付担当</label><select id="nfStaff">${staffOptions(ME.name)}</select></div><div></div>`;}
  else{meta=`<div class="full"><label>会社名（※個人の場合は空白）</label><input id="nfCustomer" value="${esc(i.customer||'')}" placeholder="株式会社 ◯◯◯　XXX営業所"></div>
   <div class="full"><label>ご担当者（敬称不要） <span style="color:var(--red)">＊</span></label><input id="nfShip2" value="${esc(i.ship2||'')}" placeholder="例：山田 太郎"></div>
   <div class="full"><label>ご依頼主（直送依頼元の商社など・任意）</label><input id="nfRequester" value="${esc(i.requester||'')}" placeholder="株式会社〇〇商事　〇〇様(エンドユーザーへ直送する依頼元)"></div>
   <div class="full"><label>依頼担当（営業など・任意）</label><select id="nfReq"><option value="">（なし）</option>${allStaffOptions(i.reqStaff||'')}</select></div>
   <div><label>受付日</label><input id="nfRecv" type="date" value="${i.recvDate||fmtISO(TODAY)}"></div><div><label>受付担当</label><select id="nfStaff">${staffOptions(i.staff||ME.name)}</select></div>
   <div><label>終了予定区分</label><select id="nfDueType" onchange="document.getElementById('nfDueWrap').style.display=this.value==='日付指定'?'block':'none'">${['日付指定','長期未定','試用完了まで','修理完了まで'].map(o=>`<option ${o===i.dueType?'selected':''}>${o}</option>`).join('')}</select></div><div></div>
   ${m==='new'?`<div><label>出荷日（任意・出荷時に確定）</label><input id="nfShip" type="date"></div>`:''}<div id="nfDueWrap" style="${(isEdit?i.dueType==='日付指定':true)?'':'display:none'}"><label>終了予定日</label><input id="nfDue" type="date" value="${(i.due&&i.dueType==='日付指定')?fmtISO(i.due):''}"></div>`;}
  const saveLabel=isResv?'予約する':isEdit?'更新する':'登録';
  document.getElementById('newCard').innerHTML=`<h3>${title}</h3><div class="msub">${sub}</div>
   ${vendor}${addArea}
   <div id="nfItemList" style="margin:10px 0"></div>
   <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
   <div class="formgrid">${meta}
   <div class="full"><label>備考（案件全体）</label><textarea id="nfNote" rows="2">${esc(i.note||'')}</textarea></div></div>
   <div class="mbtns"><button onclick="cls('newModal')">キャンセル</button><button class="primary" onclick="submitForm()">${saveLabel}</button></div>`;
  renderSerialArea();renderItemList();}
function renderSerialArea(){const el=document.getElementById('nfSerialArea');if(!el)return;
  if(!nfCode){el.innerHTML='<label>シリアル</label><div class="note" style="margin-top:0">先に商品を選んでください。</div>';return;}
  if(nfSrc==='exist'){const used=nfItems.map(i=>i.unitId);
    const pool=(formMode==='reserve')?unitsOf(nfCode):unitsOf(nfCode).filter(u=>statusOf(u).key==='貸出可');
    const avail=pool.filter(u=>used.indexOf(u.id)<0);
    el.innerHTML=`<label>シリアル${formMode==='reserve'?'':'（貸出可のみ）'}</label><select id="nfUnit">${avail.length?avail.map(u=>`<option value="${u.id}">#${esc(u.sn)}（${typeText(u)}）${u.note?' ※'+esc(u.note):''}</option>`).join(''):'<option value="">対象シリアルなし</option>'}</select>`;}
  else{el.innerHTML=`<label>種別</label><select id="nfStockKind"><option>在庫</option><option>営業機</option><option>イベント用サンプル</option><option>その他</option></select><label style="display:block;margin-top:8px">シリアル（在庫から供出）</label><div class="radios"><label class="ro"><input type="radio" name="nfsn" value="real" checked onchange="nfSn('real')"> 実シリアルを入力</label><div id="nfRealWrap" class="indent"><input id="nfReal" placeholder="例：10150494"></div><label class="ro"><input type="radio" name="nfsn" value="auto" onchange="nfSn('auto')"> 自動採番（無刻印品）</label><div id="nfAutoWrap" class="indent" style="display:none"><input id="nfAuto" disabled value="${nextAuto(nfCode)}"></div><label class="ro"><input type="radio" name="nfsn" value="tbd" onchange="nfSn('tbd')"> 出荷時に入力（受付時は未定）</label></div>`;}}
function setNfSrc(s){nfSrc=s;renderSerialArea();}
function nfFilter(){const q=document.getElementById('nfSearch').value.trim().toLowerCase(),res=products.filter(p=>(p.name+p.code+p.maker+p.cat).toLowerCase().includes(q)).slice(0,8),box=document.getElementById('nfCombo');box.innerHTML=res.length?res.map(p=>`<div class="ci" onmousedown="nfPick('${p.code}')"><b>${esc(p.name)}</b> <span style="color:var(--muted)">${esc(p.maker)}</span></div>`).join(''):'<div class="ci" style="color:var(--muted)">該当なし</div>';box.style.display='block';}
function nfPick(c){nfCode=c;document.getElementById('nfSearch').value=prodOf(c).name;document.getElementById('nfCombo').style.display='none';renderSerialArea();}
function nfSn(m){document.getElementById('nfRealWrap').style.display=m==='real'?'block':'none';document.getElementById('nfAutoWrap').style.display=m==='auto'?'block':'none';}
function addItem(){if(!nfCode){alert('商品を選択してください');return;}const it={prod:nfCode,name:prodOf(nfCode).name,mode:nfSrc,attach:val('nfItemAttach'),itemNote:val('nfItemNote')};
  if(nfSrc==='exist'){const uid=val('nfUnit');if(!uid){alert('対象シリアルを選択してください');return;}const u=units.find(x=>x.id===uid);it.unitId=uid;it.sn=u?u.sn:'';it.type=u?u.type:'';it.unitNote=u?u.note:'';}
  else{const sm=(document.querySelector('input[name=nfsn]:checked')||{}).value||'real';it.stockKind=val('nfStockKind')||'在庫';
    if(sm==='real'){it.serialType='実シリアル';it.serial=val('nfReal');if(!it.serial){alert('実シリアルを入力してください');return;}it.sn=it.serial;}
    else if(sm==='auto'){it.serialType='自動採番';it.serial='';it.sn='(自動採番)';}
    else{it.serialType='出荷時未定';it.serial='';it.sn='(出荷時入力)';}
    it.type='在庫';}
  nfItems.push(it);nfCode='';document.getElementById('nfSearch').value='';document.getElementById('nfItemAttach').value='';document.getElementById('nfItemNote').value='';renderSerialArea();renderItemList();}
function removeItem(i){if(nfItems[i]&&nfItems[i].shipped){alert('出荷済みの明細は削除できません');return;}nfItems.splice(i,1);renderSerialArea();renderItemList();}
function renderItemList(){const el=document.getElementById('nfItemList');if(!el)return;
  const inp='style="width:100%;padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-size:12px;font-family:inherit"';
  el.innerHTML=nfItems.length?`<table class="list"><thead><tr><th>商品</th><th>シリアル</th><th>種別</th><th style="width:140px">付属品</th><th style="width:140px">明細備考</th><th></th></tr></thead><tbody>${nfItems.map((it,i)=>`<tr><td>${esc(it.name)}${noteI(it.unitNote)}</td><td>#${esc(it.sn||'(自動採番)')}</td><td>${it.mode==='stock'?'在庫から新規 '+typeText({type:it.stockKind||'在庫',prod:it.prod,id:''}):typeText(units.find(x=>x.id===it.unitId)||{type:it.type,prod:it.prod,id:it.unitId})}${it.shipped?' <span class="pill" style="background:var(--blueBg);color:var(--blue)">出荷済</span>':''}</td><td><input value="${esc(it.attach||'')}" oninput="nfItems[${i}].attach=this.value" ${inp}></td><td><input value="${esc(it.itemNote||'')}" oninput="nfItems[${i}].itemNote=this.value" ${inp}></td><td>${it.shipped?'<span style="color:#cbd5e1">固定</span>':`<button class="btn" onclick="removeItem(${i})">×</button>`}</td></tr>`).join('')}</tbody></table>`:'<p class="note">「＋ 明細に追加」で貸し出すシリアルを追加してください（複数可）。</p>';bindTips();}
function val(id){const e=document.getElementById(id);return e?e.value:'';}
function submitForm(){const m=formMode;if(!nfItems.length){alert('明細を1件以上追加してください');return;}
  const note=val('nfNote'),staff=val('nfStaff'),customer=val('nfCustomer');
  const done=cb=>(busyOn(),google.script.run).withSuccessHandler(()=>{cls('newModal');reload();}).withFailureHandler(e=>{busyOff();alert(e.message)});
  if(m==='reserve'){const start=val('nfStart'),end=val('nfEnd');if(!customer||!start||!end){alert('予約先・期間を入力してください');return;}
    const items=nfItems.map(it=>({unitId:it.unitId,sn:it.sn,attach:it.attach||'',itemNote:it.itemNote||''}));
    done().createReservationGroup({items:items,customer:customer,start:start,end:end,staff:staff,note:note});return;}
  const ship2=val('nfShip2');if(!ship2){alert('ご担当者を入力してください');return;}
  const f={items:nfItems,customer:customer,ship2:ship2,requester:val('nfRequester'),reqStaff:val('nfReq'),recvDate:val('nfRecv'),staff:staff,dueType:val('nfDueType'),due:val('nfDue'),note:note};
  if(m==='edit'){done().updateCaseFull(formEditLoanId,f);}
  else{f.shipDate=val('nfShip');done().createLoanGroup(f);}}

/* 予約 → 共通フォーム（reserve）。複数明細を1予約案件に */
function openResv(code){openForm('reserve',code);}
function doCancelResv(id,caseId){if(!confirm('この予約をキャンセル（削除）しますか？'))return;(busyOn(),google.script.run).withSuccessHandler(()=>{closePanel();reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).cancelReservation(id,caseId||'');}

/* シリアル・商品・ユーザー登録 */
function editUnitNote(uid){const u=units.find(x=>x.id===uid);if(!u)return;const v=prompt('個体備考（シリアル備考）を編集',u.note||'');if(v===null)return;busyOn();google.script.run.withSuccessHandler(()=>{closePanel();reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).updateUnitNote(uid,v);}
function submitUnit(){if(!urSelCode){alert('商品を選択してください');return;}const isReal=document.getElementById('urRealWrap').style.display!=='none';
  const p={prod:urSelCode,serialType:isReal?'実シリアル':'自動採番',serial:isReal?val('urReal'):val('urAuto'),kind:val('urKind'),origin:val('urOrigin'),startDate:val('urStart'),note:val('urNote')};if(isReal&&!p.serial){alert('実シリアルを入力してください');return;}
  (busyOn(),google.script.run).withSuccessHandler(()=>{alert('シリアルを登録しました');reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).createUnit(p);}
function submitProduct(){const p={code:val('npCode'),name:val('npName'),maker:val('urMaker'),cat:val('urCat')};if(!p.code||!p.name){alert('品番・品名を入力してください');return;}
  (busyOn(),google.script.run).withSuccessHandler(()=>{alert('商品を登録しました。「既存商品にシリアル追加」でシリアルを登録してください');urTab='exist';reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).createProduct(p);}
function submitUser(){const p={mail:val('uMail'),last:val('uLast'),first:val('uFirst'),role:val('uRole')};if(!p.mail||!p.last){alert('メール・姓を入力してください');return;}
  (busyOn(),google.script.run).withSuccessHandler(()=>{reload();}).withFailureHandler(e=>{busyOff();alert(e.message)}).createUser(p);}

