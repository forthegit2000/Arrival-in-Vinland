/** Hand-tool work estimates: effective labor hours, separate from travel and curing. */
(function (root) {
  'use strict';
  const RULES = {
    timber: { load: 0.03, rate: 3.6, density: 500, task: 'timber' },
    firewood: { load: 15, rate: 60, density: 1, task: 'timber' },
    turf: { load: 0.02, rate: 0.4, density: 750, task: 'turf' },
    hay: { load: 12, rate: 30, density: 1, task: 'hay' },
    freshFish: { load: 1, rate: 3, density: 1, task: 'fishing' },
    plants: { load: 1, rate: 2, density: 1, task: 'foraging' },
  };
  const ACTIVITIES = {
    clearing: 'Clearing a safe felling area',
    felling: 'Felling the tree',
    limbing: 'Removing branches',
    bucking: 'Cross-cutting the fallen trunk',
    splitting: 'Splitting firewood',
    loading: 'Bundling a load',
    sharpening: 'Whetting the tool and resting',
    mowing: 'Mowing grass',
    drying: 'Waiting for the hay to dry',
    cutting: 'Cutting and stacking turf',
    fishing: 'Fishing',
    foraging: 'Picking edible plants',
    preparingBatch: 'Preparing the batch',
    unloadingBatch: 'Unloading the finished batch',
  };
  const AXE_ACTIVITIES = new Set(['felling', 'limbing', 'bucking', 'splitting']);
  const MOW_SQUARE_METRES_PER_HOUR = 180;
  const HAY_FAIR_DAYLIGHT_HOURS = 16;
  const TOOL_WORK_SECONDS = 900;
  const TOOL_CARE_SECONDS = 45;
  function treeBudget(node) {
    const diameterCm = Math.max(5, node.radius * 200);
    const hardwood = node.species === 'birch' ? 1.25 : 1;
    const usableLength = Math.max(1.2, node.height * 0.65);
    const crossCuts = Math.max(1, Math.ceil(usableLength / 1.2) - 1);
    return {
      clearingHours: 90 / 3600,
      fellingHours: (30 + 0.6 * diameterCm ** 2 * hardwood) / 3600,
      limbingHours: Math.max(60, node.height * 60 * hardwood) / 3600,
      buckingHours: (crossCuts * (20 + 0.4 * (diameterCm * 0.65) ** 2 * hardwood)) / 3600,
    };
  }
  function loadHours(node, resource, amount) {
    if (node.kind === 'tree' && resource === 'firewood')
      return amount / RULES.firewood.rate + 30 / 3600;
    return amount / RULES[resource].rate;
  }
  function isWorkTime(sim, person) {
    const end = 8 + (person.order?.type === 'work' ? sim.state.politics.workHours : 10);
    return sim.hour >= 8 && sim.hour < end;
  }

  /** Read-only report of the gathering job, including while its owner speaks.
   * Conversation pauses execution, but should still explain the current job.
   * Keep saved phases unchanged; loading is an activity within 'working'.
   */
  function gatheringState(sim, person) {
    const order = person.order;
    const gathering =
      order?.type === 'gather' ||
      (order?.type === 'work' && ['fishing', 'foraging'].includes(order.task));
    if (!gathering) return null;
    if (!isWorkTime(sim, person)) return { phase: 'resting' };
    // A stored blocker always takes precedence over the last work activity.
    if (order.status) return { phase: 'waiting', reason: order.status };
    if (order.phase === 'unloading') return { phase: 'unloading' };
    if (person.cargo || order.phase === 'store')
      return { phase: 'travelling', destination: 'store' };
    if (person.moving || ['site', 'forest'].includes(order.phase))
      return { phase: 'travelling', destination: 'site' };
    if (['working', 'cutting'].includes(order.phase)) {
      if (order.activity === 'loading') return { phase: 'loading' };
      if (order.activity === 'drying') return { phase: 'waiting', reason: ACTIVITIES.drying + '.' };
      return { phase: 'working', activity: order.activity };
    }
    return { phase: 'finding' };
  }

  function isWorking(sim, person) {
    const order = person.order;
    return (
      !!order &&
      order.phase === 'working' &&
      !person.moving &&
      !person.cargo &&
      !order.status &&
      person.health >= 35 &&
      isWorkTime(sim, person) &&
      person.id !== sim.conversationPersonId
    );
  }
  const api = {
    RULES,
    ACTIVITIES,
    AXE_ACTIVITIES,
    MOW_SQUARE_METRES_PER_HOUR,
    HAY_FAIR_DAYLIGHT_HOURS,
    TOOL_WORK_SECONDS,
    TOOL_CARE_SECONDS,
    treeBudget,
    loadHours,
    gatheringState,
    isWorking,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandWorkTiming = api;
})(typeof window === 'undefined' ? globalThis : window);
