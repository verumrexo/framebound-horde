import { setStatus } from './ui-state.js';
import { COMMAND } from '../core/protocol.js';

export function setTestConfig(app, patch) {
  if (app.game.sessionMode !== 'test') return;
  app.game.session.send(COMMAND.TEST_CONFIG_SET, patch);
}

export function resetTestFieldFromMenu(app) {
  app.game.session.send(COMMAND.TEST_CLEAR, { resetCounters: true });
  app.ui.menuConfirm = null;
  app.ui.frontEndScreen = 'game';
  setStatus(app, 'test field reset');
}
