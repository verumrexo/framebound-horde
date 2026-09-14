import { setStatus } from './ui-state.js';
import { COMMAND } from '../core/protocol.js';
import { REACTOR_CATEGORIES, RESEARCH_NODES, hasResearch, reactorBatchQuote, reactorQuote, reactorRank } from '../core/research.js';

export function openResearchStation(app, tower) {
  app.ui.selectedTowerId = tower.id;
  app.ui.towerMenuMode = 'research';
  app.ui.researchPage = 0; app.ui.researchSelection = null; app.ui.researchDetailPage = 0;
  app.ui.reactorBuyCount = 1;
}

export function stationItems(snapshot, tower) {
  if (tower.definitionId === 'arsenal') return RESEARCH_NODES.map((node) => ({ ...node,
    owned: hasResearch(snapshot,node.id), locked: node.parent !== null && !hasResearch(snapshot,node.parent),
    cost: hasResearch(snapshot,node.id) ? 0 : node.cost }));
  return REACTOR_CATEGORIES.map((category) => ({ ...category,
    rank: reactorRank(snapshot,category.id), cost: reactorQuote(snapshot,category.id)?.cost ?? null }));
}

export function purchaseStationItem(app, tower, item, batchQuote = null) {
  if (item.owned) return setStatus(app, 'already researched');
  if (item.locked) return setStatus(app, 'unlock parent research first');
  if (item.cost === null) return setStatus(app, 'upgrade capped');
  if (tower.definitionId === 'arsenal') {
    app.game.session.send(COMMAND.RESEARCH_PURCHASE, { towerId: tower.id, researchId: item.id, expectedCost: item.cost });
    return;
  }
  const quote = batchQuote || reactorBatchQuote(app.game.sessionSnapshot, item.id, app.ui.reactorBuyCount || 1);
  if (!quote || quote.rank !== item.rank) return setStatus(app, 'reactor rank or price changed');
  app.game.session.send(COMMAND.REACTOR_PURCHASE, {
    towerId: tower.id, categoryId: item.id, count: quote.count, expectedRank: quote.rank, expectedCost: quote.cost
  });
}
