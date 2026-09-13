export function resetWorldPresentation(app) {
  app.effects.baseDamage.reset();
  app.effects.assembly.reset();
  app.effects.researchWave = null;
  app.effects.relayCollapse = null;
  app.effects.defeatSeenAt = null;
}
