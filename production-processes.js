/** Physical batches: preparation labor, elapsed curing, then unloading labor. */
(function (root) {
  'use strict';
  const Storage = typeof module !== 'undefined' ? require('./storage.js') : root.VinlandStorage;
  const RULES = {
    charcoal: {
      task: 'craft',
      input: 'firewood',
      output: 'charcoal',
      minimumKg: 100,
      maximumKg: 200,
    },
    smokehouse: {
      task: 'herding',
      input: 'freshFish',
      output: 'driedFish',
      minimumKg: 1,
      maximumKg: 20,
    },
  };
  const FISH_DRYING_HOURS = 28 * 24;
  function initialize(state) {
    state.processing ||= { version: 1, batches: {} };
  }
  function begin(sim, store) {
    const rule = RULES[store.type],
      stock = store.stock[rule.input] || 0;
    if (stock < rule.minimumKg) return null;
    if (store.type === 'smokehouse' && (sim.weather.temp > 10 || sim.weather.temp < -2))
      return null;
    const inputKg = Math.min(rule.maximumKg, stock);
    const moisture = store.type === 'charcoal' ? (store.woodMoisture ?? 0.2) : 0;
    const batch = {
      kind: store.type,
      phase: 'preparing',
      inputKg,
      moisture,
      workHours: 0,
      elapsedHours: 0,
      warmHours: 0,
      preparationAgeHours: 0,
      outputKg: inputKg * (store.type === 'charcoal' ? (1 - moisture) * 0.25 : 0.24),
      prepareHours: store.type === 'charcoal' ? 0.5 + inputKg / 50 : inputKg / 10,
      unloadHours: inputKg / (store.type === 'charcoal' ? 100 : 20),
      processHours:
        store.type === 'charcoal'
          ? 48 * Math.sqrt(inputKg / 200) * (1 + Math.max(0, moisture - 0.2) * 2)
          : FISH_DRYING_HOURS,
      coolHours: store.type === 'charcoal' ? 48 * Math.sqrt(inputKg / 200) : 0,
    };
    Storage.withdraw(sim.state, store.id, rule.input, inputKg);
    sim.flow('consumption', store.type === 'charcoal' ? 'charcoalWood' : 'fishToDry', inputKg);
    sim.state.processing.batches[store.id] = batch;
    return batch;
  }
  function work(sim, person, seconds) {
    const order = person.order;
    if (order?.type !== 'work') return;
    const store = sim.state.storage.stores[order.workplaceId];
    const rule = store && RULES[store.type];
    if (!rule || order.task !== rule.task || !Storage.operational(sim.state, store)) return;
    const batch = sim.state.processing.batches[store.id] || begin(sim, store);
    if (!batch) {
      order.status =
        store.type === 'charcoal'
          ? 'Supply at least 100 kg wood to this pit.'
          : 'Supply fresh fish; stockfish needs cool weather (−2 to 10 °C).';
      return;
    }
    const skill = 0.66 + person.skills[rule.task] * 0.55;
    const condition =
      Math.max(0.3, Math.min(1, person.health / 80)) *
      Math.max(0.5, Math.min(1, (125 - person.fatigue) / 100));
    const hours = (seconds / 3600) * skill * condition * (person.trust < 25 ? 0.6 : 1);
    if (batch.phase === 'preparing' || batch.phase === 'unloading') {
      delete order.status;
      order.activity = batch.phase === 'preparing' ? 'preparingBatch' : 'unloadingBatch';
      batch.workHours += hours;
      const target = batch.phase === 'preparing' ? batch.prepareHours : batch.unloadHours;
      if (batch.workHours + 1e-9 < target) return;
      batch.workHours = 0;
      if (batch.phase === 'preparing') {
        batch.phase = 'processing';
        batch.elapsedHours = 0;
      } else {
        Storage.addAt(sim.state, store.id, rule.output, batch.outputKg);
        sim.flow('production', rule.output, batch.outputKg);
        delete sim.state.processing.batches[store.id];
      }
    } else order.status = describe(sim.state, store.id);
  }
  function advance(sim, hours) {
    if (!Object.keys(sim.state.processing.batches).length) return;
    const weather = sim.weather;
    for (const [id, batch] of Object.entries(sim.state.processing.batches)) {
      if (!Storage.operational(sim.state, sim.state.storage.stores[id])) continue;
      if (batch.kind === 'smokehouse' && batch.phase === 'preparing') {
        batch.preparationAgeHours = (batch.preparationAgeHours || 0) + hours;
        if (batch.preparationAgeHours > (weather.temp <= 0 ? 120 : 48)) {
          sim.flow('losses', 'curingFish', batch.inputKg);
          delete sim.state.processing.batches[id];
          sim.notify('Fish spoiled while waiting for preparation.', 'food');
          continue;
        }
      }
      if (!['processing', 'cooling'].includes(batch.phase)) continue;
      if (batch.kind === 'smokehouse') {
        if (weather.temp > 10) batch.warmHours += hours;
        if (batch.warmHours >= 24) {
          sim.flow('losses', 'curingFish', batch.inputKg);
          delete sim.state.processing.batches[id];
          sim.notify('A stockfish batch spoiled during prolonged warm weather.', 'food');
          continue;
        }
        const wind = Math.max(0.5, Math.min(1.5, weather.wind / 20));
        batch.elapsedHours +=
          hours * (weather.temp < -2 ? 0.05 : weather.temp > 10 || weather.rain ? 0 : wind);
      } else batch.elapsedHours += hours;
      const target = batch.phase === 'cooling' ? batch.coolHours : batch.processHours;
      if (batch.elapsedHours + 1e-9 < target) continue;
      const excess = batch.elapsedHours - target;
      batch.phase =
        batch.kind === 'charcoal' && batch.phase === 'processing' ? 'cooling' : 'unloading';
      batch.elapsedHours = batch.phase === 'cooling' ? Math.max(0, excess) : 0;
    }
  }
  function describe(state, id) {
    const batch = state.processing?.batches[id];
    if (!batch) return '';
    if (batch.phase === 'preparing')
      return `Preparing batch · ${Math.max(0, batch.prepareHours - batch.workHours).toFixed(1)} person-hours left`;
    if (batch.phase === 'unloading')
      return `Ready to unload · ${Math.max(0, batch.unloadHours - batch.workHours).toFixed(1)} person-hours left`;
    if (batch.phase === 'cooling')
      return `Charcoal cooling · ${Math.ceil(batch.coolHours - batch.elapsedHours)} hours left`;
    return batch.kind === 'charcoal'
      ? `Charcoal burning · ${Math.ceil(batch.processHours - batch.elapsedHours)} hours left`
      : `Stockfish drying · ${Math.ceil((batch.processHours - batch.elapsedHours) / 24)} fair-weather days left`;
  }
  function validate(state) {
    if (state.processing === undefined) return true;
    const processing = state.processing;
    if (
      !processing ||
      processing.version !== 1 ||
      !processing.batches ||
      Array.isArray(processing.batches)
    )
      return false;
    for (const [id, batch] of Object.entries(processing.batches)) {
      if (
        !state.storage?.stores[id] ||
        state.storage.stores[id].type !== batch.kind ||
        !RULES[batch.kind] ||
        !['preparing', 'processing', 'cooling', 'unloading'].includes(batch.phase)
      )
        return false;
      for (const key of [
        'inputKg',
        'outputKg',
        'moisture',
        'workHours',
        'elapsedHours',
        'warmHours',
        'preparationAgeHours',
        'prepareHours',
        'unloadHours',
        'processHours',
        'coolHours',
      ])
        if (!Number.isFinite(batch[key]) || batch[key] < 0) return false;
      if (
        batch.inputKg > RULES[batch.kind].maximumKg ||
        batch.outputKg > batch.inputKg ||
        batch.moisture > 0.65 ||
        batch.processHours <= 0 ||
        batch.prepareHours <= 0 ||
        batch.unloadHours <= 0
      )
        return false;
    }
    return true;
  }
  const api = { RULES, FISH_DRYING_HOURS, initialize, work, advance, describe, validate };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandProductionProcesses = api;
})(typeof window === 'undefined' ? globalThis : window);
