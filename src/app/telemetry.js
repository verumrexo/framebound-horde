import { AUTHORITY_TICK_RATE } from '../core/protocol.js';

export function killTelemetry(app, mode, snapshot) {
  const economy = snapshot.teamEconomy || { totalEarned: 0 };
  const totalEarned = Math.max(0, Math.floor(economy.totalEarned || 0));
  let telemetry = app.timing.telemetryByMode.get(mode);
  if (!telemetry
    || telemetry.playerId !== app.game.session.playerId
    || snapshot.runTick < telemetry.lastTick
    || snapshot.stats.kills < telemetry.lastKills
    || totalEarned < telemetry.lastEarned) {
    telemetry = {
      playerId: app.game.session.playerId,
      samples: [],
      lastTick: snapshot.runTick,
      lastKills: snapshot.stats.kills,
      lastEarned: totalEarned,
      peak: 0
    };
    app.timing.telemetryByMode.set(mode, telemetry);
  }
  if (snapshot.runTick !== telemetry.lastTick
    || snapshot.stats.kills !== telemetry.lastKills
    || totalEarned !== telemetry.lastEarned
    || telemetry.samples.length === 0) {
    telemetry.samples.push({ tick: snapshot.runTick, kills: snapshot.stats.kills, earned: totalEarned });
    telemetry.lastTick = snapshot.runTick;
    telemetry.lastKills = snapshot.stats.kills;
    telemetry.lastEarned = totalEarned;
    while (telemetry.samples.length > 1 && telemetry.samples[1].tick < snapshot.runTick - AUTHORITY_TICK_RATE * 10) telemetry.samples.shift();
  }
  const rateFor = (seconds, field, current) => {
    const minimumTick = snapshot.runTick - seconds * AUTHORITY_TICK_RATE;
    let sample = telemetry.samples[0] || { tick: snapshot.runTick, [field]: current };
    for (const candidate of telemetry.samples) {
      if (candidate.tick >= minimumTick) {
        sample = candidate;
        break;
      }
    }
    const ticks = Math.max(1, snapshot.runTick - sample.tick);
    return (current - sample[field]) * AUTHORITY_TICK_RATE / ticks;
  };
  const oneSecond = rateFor(1, 'kills', snapshot.stats.kills);
  const tenSecond = rateFor(10, 'kills', snapshot.stats.kills);
  const goldPerSecond = rateFor(5, 'earned', totalEarned);
  telemetry.peak = Math.max(telemetry.peak, oneSecond);
  return { oneSecond, tenSecond, peak: telemetry.peak, goldPerSecond };
}

export function formatRunTimer(runTick) {
  const totalSeconds = Math.max(0, Math.floor(runTick / AUTHORITY_TICK_RATE));
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}
