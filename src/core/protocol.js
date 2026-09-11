export const PROTOCOL_VERSION = 21;
export const AUTHORITY_TICK_RATE = 60;
export const AUTHORITY_TICK_MS = 1000 / AUTHORITY_TICK_RATE;

export const COMMAND = Object.freeze({
  DEV_TOOLS: 'dev.tools',
  JOIN: 'session.join',
  LEAVE: 'session.leave',
  SESSION_START: 'session.start',
  SESSION_RESTART: 'session.restart',
  SESSION_CONTINUE_WITHOUT_PLAYER: 'session.continue_without_player',
  RESEARCH_PURCHASE: 'research.purchase',
  REACTOR_PURCHASE: 'reactor.purchase',
  TOWER_PLACE: 'tower.place',
  TOWER_EVOLVE: 'tower.evolve',
  TOWER_SELL: 'tower.sell',
  TOWER_TARGETING_SET: 'tower.targeting.set',
  TOWER_STRIKE_POINT_SET: 'tower.strike_point.set',
  TOWER_FORCE_DIRECTION_SET: 'tower.force_direction.set',
  TOWER_CONTROL_GEOMETRY_SET: 'tower.control_geometry.set',
  TOWER_RELAY_TARGET_SET: 'tower.relay_target.set',
  TOWER_ECHO_SOURCE_SET: 'tower.echo_source.set',
  TOWER_SOCKET_SET: 'tower.socket.set',
  TEST_CONFIG_SET: 'test.config.set',
  TEST_CLEAR: 'test.clear',
  TEST_STEP: 'test.step',
  TEST_TOWER_FORM_SET: 'test.tower_form.set',
  TEST_TOWER_MOVE: 'test.tower.move'
});

export const EVENT = Object.freeze({
  SESSION_STARTED: 'session.started',
  RUN_STARTED: 'run.started',
  SESSION_RESTARTED: 'session.restarted',
  PLAYER_JOINED: 'player.joined',
  PLAYER_LEFT: 'player.left',
  PLAYER_RECONNECTED: 'player.reconnected',
  PLAYER_RECONNECT_WAIT_STARTED: 'player.reconnect_wait.started',
  PLAYER_BECAME_SPECTATOR: 'player.spectator',
  HOST_MIGRATED: 'session.host.migrated',
  BALANCED_INHERITANCE_COMPLETED: 'tower.inheritance.balanced',
  RESEARCH_PURCHASED: 'research.purchased',
  REACTOR_PURCHASED: 'reactor.purchased',
  TOWER_PLACED: 'tower.placed',
  TOWER_EVOLVED: 'tower.evolved',
  TOWER_SOLD: 'tower.sold',
  TOWER_TARGETING_CHANGED: 'tower.targeting.changed',
  TOWER_STRIKE_POINT_CHANGED: 'tower.strike_point.changed',
  TOWER_FORCE_DIRECTION_CHANGED: 'tower.force_direction.changed',
  TOWER_CONTROL_GEOMETRY_CHANGED: 'tower.control_geometry.changed',
  TOWER_RELAY_TARGET_CHANGED: 'tower.relay_target.changed',
  RELAY_NETWORK_COMPLETED: 'network.relay.completed',
  TOWER_OWNERSHIP_TRANSFERRED: 'tower.ownership.transferred',
  KILLS_RECORDED: 'combat.kills.recorded',
  ATTACK_RESOLVED: 'combat.attack.resolved',
  TEST_CONFIG_CHANGED: 'test.config.changed',
  TEST_CLEARED: 'test.cleared',
  TEST_STEPPED: 'test.stepped',
  TEST_TOWER_MOVED: 'test.tower.moved',
  BASE_BREACHED: 'base.breached',
  INCOME_DISTRIBUTED: 'economy.income.distributed',
  SUPPORT_TRIGGERED: 'support.triggered',
  COMMAND_REJECTED: 'command.rejected'
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createCommand({ clientId, playerId = null, sequence, intendedTick, type, payload = {} }) {
  if (!clientId || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('invalid command identity');
  }
  if (!Number.isSafeInteger(intendedTick) || intendedTick < 0 || !type || !isPlainObject(payload)) {
    throw new Error('invalid command envelope');
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    clientId,
    playerId,
    sequence,
    intendedTick,
    type,
    payload
  };
}

export function validateCommand(command) {
  if (!isPlainObject(command)) return 'command must be an object';
  if (command.protocolVersion !== PROTOCOL_VERSION) return 'protocol version mismatch';
  if (!command.clientId || !Number.isSafeInteger(command.sequence) || command.sequence < 1) return 'invalid command identity';
  if (!Number.isSafeInteger(command.intendedTick) || command.intendedTick < 0) return 'invalid intended tick';
  if (!Object.values(COMMAND).includes(command.type)) return 'unknown command type';
  if (!isPlainObject(command.payload)) return 'command payload must be an object';
  return null;
}

export function cloneSerializable(value) {
  return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
}
