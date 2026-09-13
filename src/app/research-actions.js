import { setStatus } from './ui-state.js';
import { COMMAND } from '../core/protocol.js';
import { REACTOR_CATEGORIES, RESEARCH_NODES, hasResearch, reactorQuote, reactorRank } from '../core/research.js';

export function openResearchStation(app, tower) {
  app.ui.selectedTowerId = tower.id;
  app.ui.towerMenuMode = 'research';
  app.ui.researchPage = 0; app.ui.researchSelection = null; app.ui.researchDetailPage = 0;
}

export function stationItems(snapshot, tower) {
  if (tower.definitionId === 'arsenal') return RESEARCH_NODES.map((node) => ({ ...node,
    owned: hasResearch(snapshot,node.id), locked: node.parent !== null && !hasResearch(snapshot,node.parent),
    cost: hasResearch(snapshot,node.id) ? 0 : node.cost }));
  return REACTOR_CATEGORIES.map((category) => ({ ...category,
    rank: reactorRank(snapshot,category.id), cost: reactorQuote(snapshot,category.id)?.cost ?? null }));
}

export function purchaseStationItem(app, tower, item) {
  if (item.owned) return setStatus(app, 'already researched');
  if (item.locked) return setStatus(app, 'unlock parent research first');
  if (item.cost === null) return setStatus(app, 'upgrade capped');
  app.game.session.send(tower.definitionId === 'arsenal' ? COMMAND.RESEARCH_PURCHASE : COMMAND.REACTOR_PURCHASE,
    tower.definitionId === 'arsenal'
      ? { towerId: tower.id, researchId: item.id, expectedCost: item.cost }
      : { towerId: tower.id, categoryId: item.id, expectedRank: item.rank, expectedCost: item.cost });
}
