import http from "http";
import { readFile } from "fs/promises";
import { extname, join } from "path";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const CARDS = {
  "共和国元帥アルフォン": {f:"modern", type:"unit", cost:7, atk:5, hp:7, class:"英雄", effects:["alfon"]},
  "共和国歩兵": {f:"modern", type:"unit", cost:2, atk:2, hp:2, class:"歩兵"},
  "共和国兵隊": {f:"modern", type:"unit", cost:4, atk:3, hp:4, class:"部隊"},
  "補給物資隊": {f:"modern", type:"unit", cost:3, atk:1, hp:3, class:"部隊", effects:["supply"]},
  "空中兵": {f:"modern", type:"unit", cost:3, atk:2, hp:2, class:"空中", air:true},
  "対空砲兵": {f:"modern", type:"unit", cost:4, atk:2, hp:5, class:"対空・部隊", effects:["antiair"]},
  "増税令": {f:"modern", type:"tactic", cost:2, effects:["draw2"]},
  "総動員令": {f:"modern", type:"tactic", cost:4, effects:["move1"]},
  "官営軍需工場": {f:"modern", type:"facility", cost:3, effects:["drawStart"]},
  "地雷原": {f:"modern", type:"trap", cost:2, effects:["mine"]},
  "鉄血補佐官 マロロ": {f:"modern", type:"unit", cost:20, atk:7, hp:7, class:"英雄", effects:["maroro"], rarity:"英雄"},
  "最後の王": {f:"lonely", type:"unit", cost:15, atk:1, hp:25, class:"英雄", effects:["king"], rarity:"英雄"},
  "独りよがりな骸": {f:"lonely", type:"unit", cost:2, atk:3, hp:1, class:"死屍"},
  "いつかの亡者": {f:"lonely", type:"unit", cost:3, atk:2, hp:3, class:"歩兵", effects:["forget"]},
  "地へと誘う手": {f:"lonely", type:"unit", cost:2, atk:3, hp:1, class:"対空", effects:["sacrifice"]},
  "頭蓋風船": {f:"lonely", type:"unit", cost:4, atk:2, hp:5, class:"空中", air:true},
  "髑髏郵送車両": {f:"lonely", type:"unit", cost:4, atk:2, hp:6, class:"対空", effects:["delivery"]},
  "あの日の記憶": {f:"lonely", type:"tactic", cost:3, effects:["memory"]},
  "死者選択": {f:"lonely", type:"tactic", cost:3, effects:["tradeDiscard"]},
  "再顕現": {f:"lonely", type:"tactic", cost:3, effects:["reappear"]},
  "地獄への扉": {f:"lonely", type:"facility", cost:3, effects:["hellDoor"]},
  "忘れられた墓場": {f:"lonely", type:"trap", cost:1, effects:["forgotten"]},
  "新人知能 オメガ": {f:"cyber", type:"unit", cost:2, atk:1, hp:3, class:"歩兵", effects:["omegaScout"]},
  "量産型知能 アルファ": {f:"cyber", type:"unit", cost:3, atk:1, hp:3, class:"歩兵", effects:["alpha"]},
  "量産型知能 ベータ": {f:"cyber", type:"unit", cost:7, atk:2, hp:8, class:"歩兵", effects:["evolve"]},
  "管理知能 オメガ": {f:"cyber", type:"unit", cost:6, atk:3, hp:5, class:"歩兵", effects:["evolve","manage"]},
  "連邦統括AI オメガ": {f:"cyber", type:"unit", cost:12, atk:4, hp:6, class:"英雄", effects:["evolve","overseer"], rarity:"英雄"},
  "初期化プログラム": {f:"cyber", type:"tactic", cost:8, effects:["reset"]},
  "亜空知能 Ω-CORE": {f:"cyber", type:"unit", cost:15, atk:10, hp:7, class:"英雄", effects:["evolve","core"], rarity:"英雄"},
  "自動迎撃知能 ガンマ": {f:"cyber", type:"unit", cost:5, atk:2, hp:6, class:"対空", effects:["evolve","gamma"]},
  "空中知能 イプシロン": {f:"cyber", type:"unit", cost:3, atk:3, hp:3, class:"空中", air:true, effects:["epsilon"]},
  "リバースレーザー砲": {f:"cyber", type:"trap", cost:9, effects:["reverseLaser"]},
  "超越した知能媒体≪unknown≫": {f:"cyber", type:"facility", cost:4, effects:["evoDraw"]},
  "緊急国会会議": {f:"common", type:"tactic", cost:12, effects:["parliament"]},
  "第1獣軍副隊長 トラ": {f:"wild", type:"unit", cost:3, atk:4, hp:3, class:"動物", effects:["roar","roarReact"]}
};

const FACTION_CARDS = {
  modern:["共和国元帥アルフォン","共和国歩兵","共和国兵隊","補給物資隊","空中兵","対空砲兵","増税令","総動員令","官営軍需工場","地雷原","鉄血補佐官 マロロ"],
  lonely:["最後の王","独りよがりな骸","いつかの亡者","地へと誘う手","頭蓋風船","髑髏郵送車両","あの日の記憶","死者選択","再顕現","地獄への扉","忘れられた墓場"],
  cyber:["新人知能 オメガ","量産型知能 アルファ","量産型知能 ベータ","管理知能 オメガ","連邦統括AI オメガ","初期化プログラム","亜空知能 Ω-CORE","自動迎撃知能 ガンマ","空中知能 イプシロン","リバースレーザー砲","超越した知能媒体≪unknown≫"]
};

function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function uid(){return crypto.randomBytes(8).toString("hex");}
function makeDeck(f){
  const names=[...FACTION_CARDS[f],"緊急国会会議"];
  const d=[]; while(d.length<50) d.push(names[d.length%names.length]);
  return shuffle(d);
}
function newPlayer(f){
  return {faction:f, deck:makeDeck(f), hand:[], grave:[], resources:[], board:Array.from({length:7},()=>[]), facility:null, traps:Array.from({length:7},()=>[]), base:5};
}
function publicState(room, pidx){
  const p=room.players[pidx], opp=room.players[1-pidx];
  const maskUnits = p.board.map(row=>row.map(u=>u));
  const oppBoard = opp.board.map(row=>row.map(u=>({...u, name:u.name, hidden:false})));
  return {
    phase:room.phase, turn:room.turn, you:pidx, winner:room.winner,
    players:[0,1].map(i=>({faction:room.players[i].faction,base:room.players[i].base,hand:i===pidx?room.players[i].hand:room.players[i].hand.length,deck:room.players[i].deck.length,grave:[...room.players[i].grave],resources:room.players[i].resources.length,readyResources:room.players[i].resources.filter(r=>!r.used).length,usedResources:room.players[i].resources.filter(r=>r.used).length})),
    board:[maskUnits,oppBoard], facility:p.facility, traps:p.traps.map(t=>t.length),
    hand:[...p.hand],
    log:room.log.slice(-40)
  };
}
function log(room,msg){room.log.push(msg);}

function draw(p,n=1){
  for(let i=0;i<n;i++){
    if(p.deck.length===0) return false;
    p.hand.push(p.deck.pop());
  }
  return true;
}
function untap(p){p.resources.forEach(r=>r.used=false);}
function costPay(p,cost){
  const ready=p.resources.filter(r=>!r.used);
  if(ready.length<cost) return false;
  ready.slice(0,cost).forEach(r=>r.used=true); return true;
}
function unitsCount(room){return room.players.reduce((s,p)=>s+p.board.flat().length,0);}
function canPlace(p,lane){
  return p.board[0+lane].length<2;
}
function unitAt(p,lane,pos){return p.board[pos]?.find(u=>u.lane===lane);}
function addUnit(p,name,lane,pos=0){
  const c=CARDS[name]; const u={id:uid(),name,lane,hp:c.hp,maxHp:c.hp,atk:c.atk,canMove:false,air:!!c.air, effects:c.effects||[], class:c.class};
  p.board[pos].push(u); return u;
}
function removeUnit(p,u){
  const row=p.board[u.pos]; if(!row) return;
  const i=row.findIndex(x=>x.id===u.id); if(i>=0) row.splice(i,1);
  p.grave.push(u.name);
}
function getUnit(room,owner,id){
  for(let pos=0;pos<7;pos++){const u=room.players[owner].board[pos].find(x=>x.id===id);if(u){u.pos=pos;return u;}}
  return null;
}
function resolveBattle(room,atkOwner,atk,pos,lane,def){
  const defenderOwner=1-atkOwner;
  const fromPos=atk.pos;
  const atkCard=CARDS[atk.name], defCard=CARDS[def.name];
  const atkPower=atk.atk + (defCard.class?.includes("空中") && atkCard.effects?.includes("antiair")?2:0);
  const defPower=def.atk + (atkCard.class?.includes("空中") && defCard.effects?.includes("対空")?2:0);
  def.hp-=atkPower; atk.hp-=defPower;
  log(room,`⚔️ ${atk.name} → ${def.name}: ${atkPower}ダメージ / 反撃 ${defPower}ダメージ`);
  const aDead=atk.hp<=0, dDead=def.hp<=0;
  if(dDead){ const row=room.players[defenderOwner].board[pos]; row.splice(row.findIndex(x=>x.id===def.id),1); room.players[defenderOwner].grave.push(def.name); }
  if(aDead){ const row=room.players[atkOwner].board[fromPos]; const i=row.findIndex(x=>x.id===atk.id); if(i>=0) row.splice(i,1); room.players[atkOwner].grave.push(atk.name); }
  if(!aDead && dDead) {
    const fromRow=room.players[atkOwner].board[fromPos];
    const i=fromRow.findIndex(x=>x.id===atk.id);
    if(i>=0) fromRow.splice(i,1);
    room.players[atkOwner].board[pos].push(atk); atk.pos=pos;
    log(room,`➡️ ${atk.name} が${pos+1}マス目に残る`);
  }
  if(!aDead && !dDead) { // explicit retreat rule
    const row=room.players[atkOwner].board[fromPos]; const i=row.findIndex(x=>x.id===atk.id); if(i>=0) row.splice(i,1);
    const retreatPos=atkOwner===0?pos-1:pos+1;
    if(retreatPos>=0 && retreatPos<7){ room.players[atkOwner].board[retreatPos].push(atk); atk.pos=retreatPos; log(room,`↩️ ${atk.name} は${retreatPos+1}マス目へ後退`); }
    else { room.players[atkOwner].grave.push(atk.name); log(room,`💀 ${atk.name} は後退先がなく墓地へ`); }
  }
  if(aDead&&dDead) log(room,"💀 相打ち。両者墓地へ");
}
function applyTrap(room,owner,enemyOwner,lane,pos,u){
  const enemy=room.players[enemyOwner];
  const traps=enemy.traps[pos]||[];
  if(!traps.length) return;
const t=traps.shift();
const c=CARDS[t.name];

room.sockets.forEach(ws=>{
  if(ws?.readyState===1){
    ws.send(JSON.stringify({
      type:"trapEffect",
      title:"💣 罠発動！",
      text:`${t.name} が ${u.name} に発動！`
    }));
  }
});
  if(c.effects?.includes("mine")){u.hp-=3;log(room,`💣 地雷原が${u.name}に3ダメージ`);}
  else if(c.effects?.includes("forgotten")){u.canMove=false;u.rooted=true;log(room,`💀 忘れられた墓場：${u.name}は次のターン進軍不可`);}
  else if(c.effects?.includes("reverseLaser")){ enemy.hand.push(u.name); const row=enemy.board[pos];row.splice(row.findIndex(x=>x.id===u.id),1);enemy.grave.push(t.name); log(room,`⚠️ リバースレーザー砲：${u.name}を手札へ`); return; }
  enemy.grave.push(t.name);
  if(u.hp<=0){const row=room.players[owner].board[pos];row.splice(row.findIndex(x=>x.id===u.id),1);room.players[owner].grave.push(u.name);}
}
function endTurn(room){
  const p=room.players[room.turn], next=1-room.turn;
  p.board.flat().forEach(u=>{u.rooted=false;});
  p.resourcePlaced=false;
  if(room.turn===1) room.round++;
  room.turn=next; room.phase="draw"; room.players[next].resourcePlaced=false;
  room.players[next].board.flat().forEach(u=>u.canMove=false);
}
function startTurn(room){
  const p=room.players[room.turn]; untap(p);
  if(room.turn===0 && room.round===1){} else draw(p,1);
  p.board.flat().forEach(u=>u.canMove=true);
  room.phase="main";
  if(p.facility && CARDS[p.facility.name]?.effects?.includes("drawStart")) draw(p,1);
  if(p.facility && CARDS[p.facility.name]?.effects?.includes("hellDoor") && p.deck.length) p.grave.push(p.deck.pop());
  if(p.board.flat().some(u=>u.rooted)) p.board.flat().forEach(u=>u.rooted=false);
  room.moveCount=0;
  log(room,`▶️ ${room.turn===0?"先攻":"後攻"}のターン`);
}
function checkWin(room){
  if(room.players[0].base<=0) room.winner=1;
  if(room.players[1].base<=0) room.winner=0;
  if(room.players.some(p=>p.deck.length===0)) room.winner=room.players.findIndex(p=>p.deck.length===0)^1;
}
function action(room,pidx,msg){
  const p=room.players[pidx]; if(room.winner!==null) throw Error("ゲーム終了"); if(room.turn!==pidx) throw Error("相手のターンです");
  const a=msg.action;
  if(a==="resource"){
    if(p.resourcePlaced) throw Error("今ターンは資源配置済み");
    if(!p.hand[msg.hand]) throw Error("手札がありません");
    const name=p.hand.splice(msg.hand,1)[0]; p.resources.push({name,used:false}); p.resourcePlaced=true; log(room,`💎 ${name} を資源化`);
  } else if(a==="play"){
    const name=p.hand[msg.hand], c=CARDS[name]; if(!c) throw Error("カード不正");
    if(c.type==="unit"){
      const lane=msg.lane;
      const startPos=pidx===0?0:6;
      if(lane<0||lane>2||p.board[startPos].filter(u=>u.lane===lane).length>=2) throw Error("配置不可");
      if(!costPay(p,c.cost)) throw Error("資源不足");
      p.hand.splice(msg.hand,1);
      const u=addUnit(p,name,lane,startPos); u.pos=startPos; 
      if(c.effects?.includes("supply") && p.deck.length) { p.resources.push({name:p.deck.pop(),used:false}); log(room,"📦 補給物資隊：山札の上を資源へ"); }
      if(c.effects?.includes("alpha") && p.deck.length) { p.resources.push({name:p.deck.pop(),used:false}); log(room,"🤖 アルファ：山札の上を資源へ"); }
      if(c.effects?.includes("draw2")) draw(p,2);
      if(c.effects?.includes("alfon")){
        const candidates=p.board.flat().filter(x=>x.id!==u.id && (x.class?.includes("歩兵")||x.class?.includes("部隊")));
        const target=candidates.find(x=>{const np=x.pos+(pidx===0?1:-1); return np>=0&&np<7&&!p.board[np].some(y=>y.lane===x.lane);});
        if(target){
          const np=target.pos+(pidx===0?1:-1); p.board[target.pos]=p.board[target.pos].filter(x=>x.id!==target.id); p.board[np].push(target); target.pos=np; log(room,`👑 元帥の号令：${target.name}を1マス進軍`); }
        const count=p.board.flat().filter(x=>x.class?.includes("歩兵")||x.class?.includes("部隊")).length; if(count) {draw(p,count); log(room,`🧠 戦略的指揮：${count}枚ドロー`);}
      }
      if(c.effects?.includes("maroro")) u.canMove=true;
      if(c.effects?.includes("overseer")){
        const candidate=p.deck.find(n=>CARDS[n]?.effects?.includes("evolve"));
        if(candidate){p.deck.splice(p.deck.indexOf(candidate),1); const startPos2=pidx===0?0:6; const lane2=[0,1,2].find(l=>p.board[startPos2].filter(x=>x.lane===l).length<2); if(lane2!==undefined){const u2=addUnit(p,candidate,lane2,startPos2);u2.pos=startPos2;}}
      }
      log(room,`🪖 ${name} を${lane+1}レーンに配置`);
    } else if(c.type==="facility"){
      if(!costPay(p,c.cost)) throw Error("資源不足");

      p.hand.splice(msg.hand,1);

      if(p.facility) p.grave.push(p.facility.name);
      p.facility={name};

      log(room,`🏭 ${name} を設置`);

    } else if(c.type==="trap"){
      const pos=msg.pos;
      const allowedPos=pidx===0?[0,1]:[6,5];

      if(!allowedPos.includes(pos)){
        throw Error("罠は自陣の1・2マス目にしか設置できません");
      }

      const enemy=room.players[1-pidx];

      if(enemy.board[pos].length>0){
        throw Error("そのマスには敵がいるため罠を置けません");
      }

      if(p.traps[pos]?.length){
        throw Error("そのマスにはすでに罠があります");
      }

      if(!costPay(p,c.cost)){
        throw Error("資源不足");
      }

      p.hand.splice(msg.hand,1);

      p.traps[pos]=p.traps[pos]||[];
      p.traps[pos].push({name});

      log(room,`💣 ${name} を${pos+1}マス目に設置`);

    } else {
      if(!costPay(p,c.cost)){
        throw Error("資源不足");
      }

      p.hand.splice(msg.hand,1);
p.grave.push(name);
console.log("GRAVE TEST:", p.grave);
      if(c.effects?.includes("draw2")){
        draw(p,2);

      } else if(c.effects?.includes("move1")){
        const target=getUnit(room,pidx,msg.unitId);
        if(!target) throw Error("進軍する兵を指定してください");

        const dir=pidx===0?1:-1, np=target.pos+dir;

        if(np<0||np>6){
          room.players[1-pidx].base-=1;
          p.board[target.pos]=p.board[target.pos].filter(x=>x.id!==target.id);
          p.grave.push(target.name);
          draw(p,1);
          draw(room.players[1-pidx],2);
          log(room,`🏰 総動員令：${target.name}が本拠地へ1ダメージ`);
        } else {
          const def=room.players[1-pidx].board[np].find(x=>x.lane===target.lane);

          if(def){
            resolveBattle(room,pidx,target,np,target.lane,def);
          } else {
            p.board[target.pos]=p.board[target.pos].filter(x=>x.id!==target.id);
            p.board[np].push(target);
            target.pos=np;
            applyTrap(room,pidx,1-pidx,target.lane,np,target);
          }
        }

      } else if(c.effects?.includes("reset")){
        p.grave.forEach(n=>p.deck.push(n));
        p.grave=[];
        shuffle(p.deck);

      } else if(c.effects?.includes("parliament")){
        const limit=unitsCount(room);
        const actual=Math.max(0,12-limit);

        if(actual>0){}

        for(let oi=0;oi<2;oi++){
          const op=room.players[1-pidx];

          op.board=op.board.map(row=>row.filter(u=>{
            if(CARDS[u.name].cost<=3){
              op.hand.push(u.name);
              return false;
            }
            return true;
          }));
        }

      } else if(c.effects?.includes("tradeDiscard")){
        if(room.players[1-pidx].hand.length){
          p.grave.push(p.hand.pop());
        }

      } else if(c.effects?.includes("memory")){
        for(
          let i=0;
          i<Math.min(7,p.grave.filter(n=>n==="独りよがりな骸").length);
          i++
        ){
          if(p.deck.length){
            p.resources.push({
              name:p.deck.pop(),
              used:false
            });
          }
        }

      } else if(c.effects?.includes("reappear")){
        const lane=msg.lane??0;
        const idx=p.grave.indexOf("独りよがりな骸");

        if(idx>=0){
          p.grave.splice(idx,1);
          addUnit(p,"独りよがりな骸",lane,0);
        } else {
          for(let i=0;i<2&&p.deck.length;i++){
            p.grave.push(p.deck.pop());
          }
        }
      }

      log(room,`📜 ${name} を使用`);
    }
  } else if(a==="move"){
    if(room.moveCount>=2) throw Error("進軍は1ターン2回まで");
    const u=getUnit(room,pidx,msg.id); if(!u) throw Error("兵がいません"); if(!u.canMove||u.rooted) throw Error("この兵は進軍できません");
    const dir=pidx===0?1:-1, next=u.pos+dir;
    if(next>6 || next<0){room.players[1-pidx].base-=1; p.grave.push(u.name);p.board[u.pos]=p.board[u.pos].filter(x=>x.id!==u.id);log(room,`🏰 ${u.name} が本拠地へ1ダメージ！`);draw(p,1);draw(room.players[1-pidx],2);checkWin(room);return;}
    const target=room.players[1-pidx].board[next].find(x=>x.lane===u.lane);
    if(target) resolveBattle(room,pidx,u,next,u.lane,target);
    else {p.board[u.pos]=p.board[u.pos].filter(x=>x.id!==u.id);p.board[next].push(u);u.pos=next;applyTrap(room,pidx,1-pidx,u.lane,next,u);}
    u.canMove=false; room.moveCount++;
  } else if(a==="pass"){ endTurn(room); p.resourcePlaced=false; startTurn(room); }
  checkWin(room);
}

function createRoom(f){
  let code="";
  do{
    code=Math.random().toString(36).slice(2,7).toUpperCase();
  }while(rooms.has(code));

  rooms.set(code,{
    code,
    players:[newPlayer(f),null],
    sockets:[null,null],
    turn:0,
    phase:"draw",
    round:1,
    moveCount:0,
    winner:null,
rematch:[false,false],
    log:["ルーム作成。相手を待っています。"]
  });

  return code;

function handleRematch(room,pidx){
  if(!room || !room.players[1]) throw Error("相手がいません");
  if(room.winner===null) throw Error("まだ試合中です");

  if(!Array.isArray(room.rematch)){
    room.rematch=[false,false];
  }

  room.rematch[pidx]=true;

  console.log("🔄 再戦希望:",room.rematch);

  if(!(room.rematch[0] && room.rematch[1])){
    broadcast(room);
    return;
  }

  console.log("✅ 両者再戦OK");

  room.rematch=[false,false];

  startNewGame(room);
}
```

function startNewGame(room){
console.log("🔥 START NEW GAME");
  const f0=room.players[0].faction;
  const f1=room.players[1].faction;

  room.players=[
    newPlayer(f0),
    newPlayer(f1)
  ];

  draw(room.players[0],6);
  draw(room.players[1],6);

  room.turn=Math.random()<0.5?0:1;
  room.phase="main";
  room.round=1;
  room.moveCount=0;
  room.winner=null;

  room.players[0].resourcePlaced=false;
  room.players[1].resourcePlaced=false;

  room.log=[
    "🔄 再戦開始！",
    `🎲 ${room.turn===0?"プレイヤー1":"プレイヤー2"}が先攻`
  ];

  broadcast(room);
}
function broadcast(room){
  room.sockets.forEach((ws,i)=>{if(ws?.readyState===1)ws.send(JSON.stringify({type:"state",state:publicState(room,i)}));});
}
const server=http.createServer(async(req,res)=>{
  let p=req.url===" /" ? "/index.html" : req.url;
  if(p==="/")p="/index.html";
  try{const data=await readFile(join(process.cwd(),"public",p));const ext=extname(p);res.writeHead(200,{"Content-Type":ext===".html"?"text/html":ext===".js"?"text/javascript":"text/plain"});res.end(data);}catch{res.writeHead(404);res.end("Not found");}
});
const wss=new WebSocketServer({server});
wss.on("connection",ws=>{
  ws.on("message",raw=>{
    try{
      const m=JSON.parse(raw);
      if(m.type==="create"){const code=createRoom(m.faction);const r=rooms.get(code);r.sockets[0]=ws;ws.room=code;ws.idx=0;ws.send(JSON.stringify({type:"joined",code,idx:0}));broadcast(r);}
      else if(m.type==="join"){const r=rooms.get(m.code?.toUpperCase());if(!r||r.players[1])throw Error("ルームが見つからない/満員");r.players[1]=newPlayer(m.faction);r.sockets[1]=ws;ws.room=r.code;ws.idx=1;draw(r.players[0],6);draw(r.players[1],6);r.players[0].resourcePlaced=false;r.players[1].resourcePlaced=false;ws.send(JSON.stringify({type:"joined",code:r.code,idx:1}));broadcast(r);startTurn(r);}
      else if(m.type==="action"){const r=rooms.get(ws.room);action(r,ws.idx,m);if(r.turn===ws.idx&&m.action==="pass"){}broadcast(r);}
else if(m.type==="leaveMatch"){
  const r=rooms.get(ws.room);

  if(!r) throw Error("ルームがありません");

  // 自分をロビー状態にする
  ws.inLobby=true;

  // 相手にもロビーへ戻るよう通知
  r.sockets.forEach((sock,i)=>{
    if(sock?.readyState===1){
      sock.send(JSON.stringify({
        type:"returnLobby"
      }));
    }
  });
}
```

else if(m.type==="rematch"){
  const r=rooms.get(ws.room);

  if(!r) throw Error("ルームがありません");

  handleRematch(r,ws.idx);
}
    }catch(e){ws.send(JSON.stringify({type:"error",message:e.message}));}
  });
});
server.listen(PORT,"0.0.0.0",()=>console.log(`WORLDLINE WAR listening on ${PORT}`));
