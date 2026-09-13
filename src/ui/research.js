import { purchaseStationItem, stationItems } from '../app/research-actions.js';
import { registerHitbox } from '../app/ui-state.js';
import { compactMetric } from '../core/format.js';
import { REACTOR_CATEGORIES, RESEARCH_NODES, hasResearch, reactorRank, researchNode } from '../core/research.js';
import { COLOR } from './palette.js';
import { clippedUiText, drawButton, drawMenuButton, drawTechPanel, pointInside } from './widgets.js';

export function researchScope(id) {
  if ([13,18,25].includes(id)) return 'affects non-explosive bullets';
  if (id === 15) return 'affects laser-family beams';
  if ([26,31].includes(id)) return 'affects rocket-family weapons';
  if (id === 38) return 'weapons hitting frozen enemies';
  return 'global // existing and future towers';
}

export function wrapResearchText(text, columns) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > columns) { lines.push(line); line = ''; }
    line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines;
}

// Every research node maps to one small thematic icon kind, code-rendered from
// rectangles only (no image assets) so its function reads at a glance.

export const RESEARCH_ICON_KIND = Object.freeze({
  1: 'damage', 2: 'cadence', 3: 'range', 4: 'damage', 5: 'damage', 6: 'network', 7: 'magazine',
  8: 'targeting', 9: 'burst', 10: 'range', 11: 'range', 12: 'control', 13: 'chain', 14: 'damage',
  15: 'damage', 16: 'targeting', 17: 'chain', 18: 'blast', 19: 'network', 20: 'network', 21: 'network',
  22: 'magazine', 23: 'magazine', 24: 'magazine', 25: 'chain', 26: 'targeting', 27: 'targeting',
  28: 'burst', 29: 'burst', 30: 'burst', 31: 'blast', 32: 'cadence', 33: 'control', 34: 'targeting',
  35: 'speed', 36: 'network', 37: 'control', 38: 'control', 39: 'control'
});

export function drawResearchIcon(app, kind, x, y, color, scale = 1) {
  const px = (dx, dy, w = 1, h = 1) => app.renderer.shapes.rect(x + dx * scale, y + dy * scale, w * scale, h * scale, color);
  if (kind === 'damage') { px(3, 0); px(0, 3); px(6, 3); px(3, 6); px(2, 2, 3, 3); return; }
  if (kind === 'cadence') { px(2, 0, 3, 1); px(2, 6, 3, 1); px(0, 2, 1, 3); px(6, 2, 1, 3); px(3, 3, 1, 3); px(3, 3, 3, 1); return; }
  if (kind === 'range') { px(3, 0); px(3, 6); px(0, 3); px(6, 3); px(3, 3); return; }
  if (kind === 'network') { px(0, 1, 2, 2); px(5, 4, 2, 2); px(2, 2); px(3, 3); px(4, 4); return; }
  if (kind === 'magazine') { px(1, 1, 5, 1); px(1, 3, 5, 1); px(1, 5, 5, 1); return; }
  if (kind === 'targeting') { px(0, 0, 2, 1); px(0, 0, 1, 2); px(5, 0, 2, 1); px(6, 0, 1, 2); px(0, 5, 1, 2); px(0, 6, 2, 1); px(5, 6, 2, 1); px(6, 5, 1, 2); px(3, 3); return; }
  if (kind === 'burst') { px(1, 4, 1, 3); px(3, 2, 1, 5); px(5, 4, 1, 3); return; }
  if (kind === 'chain') { px(0, 2, 3, 1); px(0, 2, 1, 3); px(0, 4, 3, 1); px(4, 1, 3, 1); px(6, 1, 1, 3); px(4, 3, 3, 1); return; }
  if (kind === 'blast') { px(3, 0); px(1, 1); px(5, 1); px(0, 3); px(6, 3); px(1, 5); px(5, 5); px(3, 6); px(2, 2, 3, 3); return; }
  if (kind === 'control') { px(3, 0, 1, 7); px(0, 3, 7, 1); px(1, 1); px(5, 1); px(1, 5); px(5, 5); return; }
  if (kind === 'speed') { px(0, 3, 2, 1); px(2, 2); px(2, 4); px(3, 1); px(3, 5); px(4, 0); px(4, 6); return; }
  if (kind === 'plate') { px(0, 0, 7, 1); px(0, 6, 7, 1); px(0, 1, 1, 5); px(6, 1, 1, 5); px(2, 2, 3, 3); return; }
  if (kind === 'guide') { px(0, 6); px(1, 5); px(2, 4); px(3, 3); px(4, 2); px(5, 1); px(3, 0, 4, 1); px(6, 0, 1, 4); return; }
  if (kind === 'economy') { px(1, 0, 5, 1); px(1, 6, 5, 1); px(0, 1, 1, 2); px(6, 4, 1, 2); px(1, 3, 5, 1); px(3, 1, 1, 5); return; }
}

export const REACTOR_ICON_KIND = Object.freeze({
  damage: 'damage', cadence: 'cadence', range: 'range', velocity: 'speed', blast: 'blast', beam: 'burst',
  recovery: 'control', coverage: 'targeting', construction: 'economy', lives: 'plate', guidance: 'guide', sustain: 'magazine'
});

export function drawArsenalTree(app, snapshot,tower) {
  app.ui.uiHitboxes.length=0;
  const width=Math.min(620,app.viewport.logicalWidth-16),height=Math.min(330,app.viewport.logicalHeight-16);
  const x=(app.viewport.logicalWidth-width)/2,y=(app.viewport.logicalHeight-height)/2;
  const items=stationItems(snapshot,tower), column=(width-32)/3;
  app.ui.researchSelection ??= 1;
  const selected=items.find((item)=>item.id===app.ui.researchSelection)||items[0];
  drawTechPanel(app, x,y,width,height,COLOR.amber);
  app.renderer.bitmapText.draw('arsenal // upgrade tree',x+12,y+10,COLOR.amber,2);
  app.renderer.bitmapText.draw(`${snapshot.research.unlocked.length}/39 researched // every branch available`,x+12,y+30,COLOR.ink,1);
  for(let root=1;root<=3;root++) {
    const ordered=[];
    const visit=(id)=>{ordered.push(items.find((item)=>item.id===id));for(const child of items.filter((item)=>item.parent===id))visit(child.id);};
    visit(root);
    const positions=new Map(ordered.map((item,row)=>[item.id,{x:x+12+(root-1)*column+(item.tier-1)*7,y:y+48+row*14}]));
    for(const item of ordered){
      const p=positions.get(item.id),parent=positions.get(item.parent);
      if(parent){app.renderer.shapes.line(parent.x+2,parent.y+5,parent.x+2,p.y+5,1,COLOR.dimMint);app.renderer.shapes.line(parent.x+2,p.y+5,p.x,p.y+5,1,COLOR.dimMint);}
      const color=item.id===selected.id?COLOR.amber:item.owned?COLOR.mint:item.locked?COLOR.dimMint:COLOR.cyan;
      const itemWidth=column-18-(item.tier-1)*7;
      drawButton(app, `tree_${item.id}`,`${item.owned?'+':item.locked?'-':'>'} ${clippedUiText(item.label,column-38)}`,p.x,p.y,itemWidth,true,color,()=>{app.ui.researchSelection=item.id;app.ui.researchDetailPage=0;});
      drawResearchIcon(app, RESEARCH_ICON_KIND[item.id],p.x+itemWidth-9,p.y+3,color);
    }
  }
  const detailY=y+238;
  app.renderer.shapes.rect(x+12,detailY-2,18,1,COLOR.dimMint);
  app.renderer.shapes.rect(x+12,detailY+17,18,1,COLOR.dimMint);
  drawResearchIcon(app, RESEARCH_ICON_KIND[selected.id],x+14,detailY+1,COLOR.amber,2);
  app.renderer.bitmapText.draw(clippedUiText(selected.label,width-50),x+34,detailY,COLOR.amber,1);
  app.renderer.bitmapText.draw(clippedUiText(researchScope(selected.id),width-50),x+34,detailY+9,COLOR.dimMint,1);
  // The tree above already draws a connector line to the prerequisite node; no need to restate it here.
  const lines=wrapResearchText(selected.description,Math.floor((width-24)/6));
  lines.slice(0,3).forEach((line,i)=>app.renderer.bitmapText.draw(line,x+12,detailY+22+i*9,COLOR.ink,1));
  const wallet=snapshot.teamEconomy?.credits||0;
  const available=!selected.owned&&!selected.locked&&(snapshot.dev?.infiniteMoney||wallet>=selected.cost);
  const label=selected.owned?'owned':selected.locked?'unlock parent first':`buy // ${compactMetric(selected.cost)} cr // enter`;
  drawMenuButton(app, 'tree_buy',label,x+12,y+height-42,width-24,available?COLOR.mint:COLOR.red,()=>{if(available)purchaseStationItem(app, tower,selected);},available);
  drawMenuButton(app, 'tree_back','back // esc',x+12,y+height-21,width-24,COLOR.cyan,()=>app.ui.towerMenuMode='actions');
}

export function drawReactorTile(app, id, item, x, y, width, height, color, selected, action) {
  const hovered = pointInside(app, x, y, width, height);
  const rimColor = selected || hovered ? color : COLOR.dimMint;
  app.renderer.shapes.rect(x, y, width, height, COLOR.black);
  app.renderer.shapes.rect(x, y, width, 1, rimColor);
  app.renderer.shapes.rect(x, y + height - 1, width, 1, rimColor);
  app.renderer.shapes.rect(x, y, selected ? 3 : 1, height, rimColor);
  app.renderer.shapes.rect(x + width - 1, y, 1, height, rimColor);
  const icon = REACTOR_ICON_KIND[item.id];
  if (icon && height >= 32) drawResearchIcon(app, icon, x + width - 19, y + 4, selected || hovered ? color : COLOR.dimMint, 2);
  app.renderer.bitmapText.draw(clippedUiText(item.label, width - (icon && height >= 32 ? 26 : 8)), x + 4, y + 4, selected || hovered ? color : COLOR.ink, 1);
  app.renderer.bitmapText.draw(item.maxRank === null ? `rank ${item.rank}` : `${item.rank}/${item.maxRank}`, x + 4, y + height - 11, COLOR.dimMint, 1);
  const meterX = x + 4, meterY = y + height - 6, meterW = width - 8;
  app.renderer.shapes.rect(meterX, meterY, meterW, 3, COLOR.black);
  const ratio = item.maxRank ? Math.min(1, item.rank / item.maxRank) : Math.min(1, item.rank / 20);
  app.renderer.shapes.rect(meterX, meterY, Math.max(0, Math.round(meterW * ratio)), 3, item.cost === null ? COLOR.mint : color);
  registerHitbox(app, id, x, y, width, height, { action });
}

export function drawReactorGrid(app, snapshot, tower) {
  app.ui.uiHitboxes.length = 0;
  const width = Math.min(560, app.viewport.logicalWidth - 16), height = Math.min(300, app.viewport.logicalHeight - 16);
  const x = (app.viewport.logicalWidth - width) / 2, y = (app.viewport.logicalHeight - height) / 2;
  const items = stationItems(snapshot, tower);
  if (!items.some((item) => item.id === app.ui.researchSelection)) app.ui.researchSelection = items[0]?.id ?? null;
  const selected = items.find((item) => item.id === app.ui.researchSelection) || items[0];
  const wallet = snapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : snapshot.teamEconomy?.credits || 0;
  drawTechPanel(app, x, y, width, height, COLOR.amber);
  app.renderer.bitmapText.draw('reactor // global ranks', x + 12, y + 10, COLOR.amber, 2);
  app.renderer.bitmapText.draw(`credits ${snapshot.dev?.infiniteMoney ? 'inf' : compactMetric(wallet)}`, x + 12, y + 30, COLOR.ink, 1);
  const cols = 3, rows = Math.ceil(items.length / cols);
  const detailHeight = 66;
  const gridTop = y + 44, gridWidth = width - 24;
  const tileW = (gridWidth - (cols - 1) * 4) / cols;
  const tileH = Math.max(28, (height - 44 - detailHeight - (rows - 1) * 4) / rows);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const col = i % cols, row = Math.floor(i / cols);
    const tx = x + 12 + col * (tileW + 4), ty = gridTop + row * (tileH + 4);
    const capped = item.cost === null;
    const color = item.id === selected.id ? COLOR.amber : capped ? COLOR.mint : COLOR.cyan;
    drawReactorTile(app, `reactor_tile_${item.id}`, item, tx, ty, tileW, tileH, color, item.id === selected.id, () => { app.ui.researchSelection = item.id; });
  }
  const detailY = gridTop + rows * (tileH + 4) + 4;
  if (REACTOR_ICON_KIND[selected.id]) drawResearchIcon(app, REACTOR_ICON_KIND[selected.id], x + 12, detailY, COLOR.amber, 2);
  app.renderer.bitmapText.draw(clippedUiText(selected.label, width - 44), x + 32, detailY, COLOR.amber, 1);
  const lines = wrapResearchText(selected.description, Math.floor((width - 24) / 6));
  lines.slice(0, 1).forEach((line, i) => app.renderer.bitmapText.draw(line, x + 32, detailY + 9 + i * 9, COLOR.ink, 1));
  const available = selected.cost !== null && (snapshot.dev?.infiniteMoney || wallet >= selected.cost);
  const label = selected.cost === null ? 'rank capped' : `rank ${selected.rank} -> ${selected.rank + 1} // ${compactMetric(selected.cost)} cr // enter`;
  drawMenuButton(app, 'reactor_buy', label, x + 12, y + height - 42, width - 24, available ? COLOR.mint : COLOR.red, () => { if (available) purchaseStationItem(app, tower, selected); }, available);
  drawMenuButton(app, 'reactor_back', 'back // esc', x + 12, y + height - 21, width - 24, COLOR.cyan, () => app.ui.towerMenuMode = 'actions');
}

export function drawStatsPanel(app, snapshot) {
  const reactorLines = REACTOR_CATEGORIES
    .map((category) => ({ category, rank: reactorRank(snapshot, category.id) }))
    .filter(({ rank }) => rank > 0)
    .map(({ category, rank }) => `${category.label} // rank ${rank}${category.maxRank !== null ? `/${category.maxRank}` : ''}`);
  const unlocked = snapshot.research?.unlocked || [];
  const scopeCounts = new Map();
  for (const node of RESEARCH_NODES) {
    if (!hasResearch(snapshot, node.id)) continue;
    const scope = researchScope(node.id).replace('affects ', '');
    scopeCounts.set(scope, (scopeCounts.get(scope) || 0) + 1);
  }
  const mints = snapshot.towers.filter((tower) => tower.definitionId === 'mint');
  const forges = snapshot.towers.filter((tower) => tower.definitionId === 'forge');
  const constructionDiscount = Math.round((1 - Math.max(0.5, 0.98 ** reactorRank(snapshot, 'construction'))) * 100);
  const economy = snapshot.teamEconomy;
  const lines = [
    { text: 'reactor ranks', color: COLOR.amber },
    ...(reactorLines.length ? reactorLines : ['no ranks purchased']).map((text) => ({ text, color: COLOR.ink })),
    { text: 'arsenal research', color: COLOR.amber },
    { text: `${unlocked.length}/39 unlocked`, color: COLOR.ink },
    ...[...scopeCounts.entries()].map(([scope, count]) => ({ text: `${scope} // ${count}`, color: COLOR.ink })),
    { text: 'economy', color: COLOR.amber },
    { text: `+${constructionDiscount}% build discount // construction rank ${reactorRank(snapshot, 'construction')}`, color: COLOR.ink },
    { text: `${mints.length} mint-s // ${forges.length} forge-s deployed`, color: COLOR.ink },
    { text: `${compactMetric(snapshot.stats?.bonusCredits || 0)}cr shared economy bonus // ${compactMetric(economy?.totalEarned || 0)}cr earned`, color: COLOR.ink }
  ];
  const width = Math.min(280, app.viewport.logicalWidth - 16);
  const height = Math.min(20 + lines.length * 10 + 6, app.viewport.logicalHeight - app.viewport.HUD_TOP_HEIGHT - 20);
  const x = app.viewport.logicalWidth - width - 8, y = app.viewport.HUD_TOP_HEIGHT + 8;
  drawTechPanel(app, x, y, width, height, COLOR.cyan);
  app.renderer.bitmapText.draw('modifier summary // i to close', x + 8, y + 6, COLOR.cyan, 1);
  let row = 0;
  for (const line of lines) {
    const lineY = y + 20 + row * 10;
    if (lineY > y + height - 8) break;
    app.renderer.bitmapText.draw(clippedUiText(line.text, width - 16), x + 8, lineY, line.color, 1);
    row += 1;
  }
}

export function drawResearchStation(app, snapshot, tower) {
  if(tower.definitionId==='arsenal' && app.viewport.logicalWidth>=400 && app.viewport.logicalHeight>=346) return drawArsenalTree(app, snapshot,tower);
  if(tower.definitionId==='reactor' && app.viewport.logicalWidth>=400 && app.viewport.logicalHeight>=300) return drawReactorGrid(app, snapshot,tower);
  app.ui.uiHitboxes.length = 0;
  const width = Math.min(420, app.viewport.logicalWidth - 20), height = Math.min(288, app.viewport.logicalHeight - 16);
  const x = (app.viewport.logicalWidth - width) / 2, y = (app.viewport.logicalHeight - height) / 2;
  const perPage = height < 240 ? 1 : 3;
  const items = stationItems(snapshot,tower);
  const pages = Math.max(1,Math.ceil(items.length/perPage));
  app.ui.researchPage = Math.max(0,Math.min(pages-1,app.ui.researchPage));
  const visible = items.slice(app.ui.researchPage*perPage,(app.ui.researchPage+1)*perPage);
  if (!visible.some((item) => item.id === app.ui.researchSelection)) app.ui.researchSelection = visible[0]?.id ?? null;
  const selected = visible.find((item) => item.id === app.ui.researchSelection);
  drawTechPanel(app, x,y,width,height,COLOR.amber);
  app.renderer.bitmapText.draw(tower.definitionId, x+12,y+9,COLOR.amber,2);
  app.renderer.bitmapText.draw(`global research ${snapshot.research?.unlocked.length || 0}/39`,x+12,y+30,COLOR.ink,1);
  if (pages > 1) {
    drawButton(app, 'research_prev','<',x+width-77,y+9,20,true,COLOR.cyan,() => { app.ui.researchPage=(app.ui.researchPage+pages-1)%pages; app.ui.researchDetailPage=0; });
    drawButton(app, 'research_next','>',x+width-27,y+9,20,true,COLOR.cyan,() => { app.ui.researchPage=(app.ui.researchPage+1)%pages; app.ui.researchDetailPage=0; });
    app.renderer.bitmapText.draw(`${app.ui.researchPage+1}/${pages}`,x+width-53,y+12,COLOR.ink,1);
  }
  for (let i=0;i<visible.length;i++) {
    const item=visible[i];
    const cost=item.cost===null?'capped':item.cost===0?'owned':compactMetric(item.cost);
    drawMenuButton(app, `research_select_${item.id}`,`${i+1} ${clippedUiText(item.label, width - 120)}`,x+12,y+48+i*20,width-24,COLOR.mint,() => {
      app.ui.researchSelection=item.id; app.ui.researchDetailPage=0;
    },selected?.id===item.id);
    const rowIcon = RESEARCH_ICON_KIND[item.id] || REACTOR_ICON_KIND[item.id];
    if (rowIcon) drawResearchIcon(app, rowIcon,x+width-112,y+50+i*20,selected?.id===item.id?COLOR.mint:COLOR.dimMint,2);
    const wallet = (snapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : snapshot.teamEconomy?.credits || 0);
    app.renderer.bitmapText.draw(cost, x + width - 18 - cost.length * 6, y + 53 + i * 20, item.cost !== null && wallet >= item.cost ? COLOR.amber : COLOR.red, 1);
  }
  if (selected) {
    const detailY=y+54+perPage*20;
    const lines=wrapResearchText((selected.parent ? `requires ${researchNode(selected.parent).label}. ` : '')+selected.description,Math.floor((width-24)/6));
    const lineCount=Math.max(1,Math.floor((y+height-66-detailY)/9));
    const detailPages=Math.ceil(lines.length/lineCount);
    app.ui.researchDetailPage %= Math.max(1,detailPages);
    lines.slice(app.ui.researchDetailPage*lineCount,(app.ui.researchDetailPage+1)*lineCount).forEach((line,i)=>app.renderer.bitmapText.draw(line,x+12,detailY+i*9,COLOR.ink,1));
    if(detailPages>1) drawButton(app, 'research_more','details >',x+width-76,y+height-64,64,true,COLOR.cyan,()=>app.ui.researchDetailPage++);
    else app.renderer.bitmapText.draw(tower.definitionId==='arsenal'?researchScope(selected.id):`rank ${selected.rank} -> ${selected.rank+1}`,x+12,y+height-64,COLOR.ink,1);
    const wallet=(snapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : snapshot.teamEconomy?.credits || 0);
    app.renderer.bitmapText.draw(`credits ${snapshot.dev?.infiniteMoney ? 'inf' : compactMetric(wallet)} // cost ${selected.cost===null?'capped':selected.cost.toLocaleString('en-US')}`,x+12,y+height-52,COLOR.amber,1);
    const canBuy=!selected.owned && !selected.locked && selected.cost!==null && wallet>=selected.cost;
    drawMenuButton(app, 'research_buy',canBuy?(selected.cost===0?'already researched':'buy selected // enter'):selected.owned?'already researched':selected.locked?'unlock parent research first':selected.cost===null?'maximum rank reached':'need more credits',x+12,y+height-41,width-24,canBuy?COLOR.mint:COLOR.red,()=>{
      if(canBuy) purchaseStationItem(app, tower,selected);
    },canBuy);
  } else app.renderer.bitmapText.draw('all research complete',x+12,y+70,COLOR.mint,1);
  drawMenuButton(app, 'research_back','back // esc',x+12,y+height-21,width-24,COLOR.cyan,()=>app.ui.towerMenuMode='actions');
}
