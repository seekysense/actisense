// Hotel mock data — Santa Lucia Hotel
// ------------------------------------

const SIGNALS = [
  // Lobby
  { id: 'loitering_lobby',        text: 'Person standing idle in lobby for >5 min',      priority: 3, default_threshold: 0.48, default_action: 'notify',    escalation_llm: true,  source: 'embedder',    cooldown_sec: 300 },
  { id: 'unattended_luggage',     text: 'Luggage left unattended',                        priority: 2, default_threshold: 0.55, default_action: 'notify',    escalation_llm: true,  source: 'embedder',    cooldown_sec: 180 },
  { id: 'guest_arrival',          text: 'Guest approaching reception with luggage',       priority: 4, default_threshold: 0.42, default_action: 'statistic', escalation_llm: false, source: 'embedder',    cooldown_sec: 60 },
  { id: 'queue_forming',          text: 'Queue forming at reception (3+ people waiting)', priority: 3, default_threshold: 0.50, default_action: 'notify',    escalation_llm: false, source: 'embedder',    cooldown_sec: 300 },

  // Pool
  { id: 'person_in_pool_closed',  text: 'Person in pool outside opening hours',           priority: 1, default_threshold: 0.40, default_action: 'alarm',     escalation_llm: true,  source: 'embedder',    cooldown_sec: 60 },
  { id: 'child_unsupervised',     text: 'Child at poolside without adult nearby',         priority: 1, default_threshold: 0.52, default_action: 'alarm',     escalation_llm: true,  source: 'embedder',    cooldown_sec: 120 },
  { id: 'pool_occupancy',         text: 'Two or more guests using the pool',              priority: 4, default_threshold: 0.45, default_action: 'statistic', escalation_llm: false, source: 'embedder',    cooldown_sec: 300 },
  { id: 'pool_slip',              text: 'Person slipping or falling near pool edge',      priority: 1, default_threshold: 0.60, default_action: 'alarm',     escalation_llm: true,  source: 'embedder',    cooldown_sec: 30 },

  // Corridors
  { id: 'hallway_traffic',        text: 'Guest walking through corridor',                 priority: 5, default_threshold: 0.40, default_action: 'statistic', escalation_llm: false, source: 'native_axis', cooldown_sec: 30 },
  { id: 'cart_in_corridor',       text: 'Housekeeping cart parked in corridor',           priority: 4, default_threshold: 0.50, default_action: 'statistic', escalation_llm: false, source: 'embedder',    cooldown_sec: 600 },
  { id: 'door_ajar',              text: 'Guest room door left open',                      priority: 3, default_threshold: 0.55, default_action: 'notify',    escalation_llm: true,  source: 'embedder',    cooldown_sec: 300 },

  // Parking
  { id: 'vehicle_entry',          text: 'Vehicle entering parking area',                  priority: 5, default_threshold: 0.38, default_action: 'statistic', escalation_llm: false, source: 'native_axis', cooldown_sec: 20 },
  { id: 'stranger_loitering_lot', text: 'Unknown person loitering around parked cars',    priority: 2, default_threshold: 0.55, default_action: 'alarm',     escalation_llm: true,  source: 'embedder',    cooldown_sec: 180 },
  { id: 'vehicle_blocking',       text: 'Vehicle blocking entrance or fire lane',         priority: 2, default_threshold: 0.58, default_action: 'notify',    escalation_llm: true,  source: 'embedder',    cooldown_sec: 300 },

  // Bar
  { id: 'bar_occupancy',          text: 'Guests seated at the bar',                       priority: 5, default_threshold: 0.45, default_action: 'statistic', escalation_llm: false, source: 'embedder',    cooldown_sec: 300 },
  { id: 'aggressive_behavior',    text: 'Aggressive gesture or altercation',              priority: 1, default_threshold: 0.65, default_action: 'alarm',     escalation_llm: true,  source: 'embedder',    cooldown_sec: 60 },
  { id: 'intoxicated_guest',      text: 'Guest appearing heavily intoxicated',            priority: 2, default_threshold: 0.58, default_action: 'notify',    escalation_llm: true,  source: 'embedder',    cooldown_sec: 300 },

  // Spa / wellness
  { id: 'wellness_occupancy',     text: 'Guest entering wellness area',                   priority: 4, default_threshold: 0.42, default_action: 'statistic', escalation_llm: false, source: 'embedder',    cooldown_sec: 120 },
  { id: 'spa_after_hours',        text: 'Access to wellness area outside hours',          priority: 2, default_threshold: 0.50, default_action: 'alarm',     escalation_llm: true,  source: 'embedder',    cooldown_sec: 120 },
];

const AREAS = [
  {
    id: 'lobby',
    name: 'Lobby & Reception',
    floor: 'Ground floor',
    cameras: 3,
    signals: [
      { signal_id: 'loitering_lobby',    enabled: true,  threshold_override: null },
      { signal_id: 'unattended_luggage', enabled: true,  threshold_override: 0.60 },
      { signal_id: 'guest_arrival',      enabled: true,  threshold_override: null },
      { signal_id: 'queue_forming',      enabled: true,  threshold_override: null },
    ],
  },
  {
    id: 'corridor_1',
    name: 'Corridor · Floor 1',
    floor: 'Rooms 101–128',
    cameras: 2,
    signals: [
      { signal_id: 'hallway_traffic',  enabled: true,  threshold_override: null },
      { signal_id: 'cart_in_corridor', enabled: true,  threshold_override: null },
      { signal_id: 'door_ajar',        enabled: true,  threshold_override: null },
    ],
  },
  {
    id: 'corridor_2',
    name: 'Corridor · Floor 2',
    floor: 'Rooms 201–228',
    cameras: 2,
    signals: [
      { signal_id: 'hallway_traffic',  enabled: true,  threshold_override: null },
      { signal_id: 'cart_in_corridor', enabled: false, threshold_override: null },
      { signal_id: 'door_ajar',        enabled: true,  threshold_override: 0.50 },
    ],
  },
  {
    id: 'pool',
    name: 'Outdoor Pool',
    floor: 'Terrace level',
    cameras: 2,
    signals: [
      { signal_id: 'person_in_pool_closed', enabled: true, threshold_override: null, time_filter: { from: '22:00', to: '07:00' } },
      { signal_id: 'child_unsupervised',    enabled: true, threshold_override: null },
      { signal_id: 'pool_occupancy',        enabled: true, threshold_override: null },
      { signal_id: 'pool_slip',             enabled: true, threshold_override: null },
    ],
  },
  {
    id: 'parking',
    name: 'Parking Lot',
    floor: 'Exterior',
    cameras: 4,
    signals: [
      { signal_id: 'vehicle_entry',          enabled: true, threshold_override: null },
      { signal_id: 'stranger_loitering_lot', enabled: true, threshold_override: 0.62 },
      { signal_id: 'vehicle_blocking',       enabled: true, threshold_override: null },
    ],
  },
  {
    id: 'bar',
    name: 'Bar & Lounge',
    floor: 'Ground floor',
    cameras: 2,
    signals: [
      { signal_id: 'bar_occupancy',       enabled: true, threshold_override: null },
      { signal_id: 'aggressive_behavior', enabled: true, threshold_override: null },
      { signal_id: 'intoxicated_guest',   enabled: true, threshold_override: null },
    ],
  },
  {
    id: 'wellness',
    name: 'Spa & Wellness',
    floor: 'Basement',
    cameras: 2,
    signals: [
      { signal_id: 'wellness_occupancy', enabled: true, threshold_override: null },
      { signal_id: 'spa_after_hours',    enabled: true, threshold_override: null, time_filter: { from: '21:00', to: '09:00' } },
    ],
  },
  {
    id: 'gym',
    name: 'Fitness Room',
    floor: 'Basement',
    cameras: 1,
    signals: [
      { signal_id: 'wellness_occupancy', enabled: true, threshold_override: null },
    ],
  },
];

// Generate a realistic day's worth of events (Apr 23, 2026)
// ---------------------------------------------------------
function _mins(h, m) { return h * 60 + m; }
function _fmtT(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

const _EV = [];
let _evId = 1;
function _add(areaId, signalId, mins, score, note, bbox) {
  const sig = SIGNALS.find(s => s.id === signalId);
  _EV.push({
    id: 'e' + String(_evId++).padStart(4, '0'),
    area_id: areaId,
    signal_id: signalId,
    at: mins,
    at_str: _fmtT(mins),
    score,
    action: sig.default_action,
    priority: sig.priority,
    note: note || null,
    bbox: bbox || null,
    llm_triggered: sig.escalation_llm && sig.default_action !== 'statistic',
  });
}

// Lobby — busy all day, peaks at check-in/out
for (let h = 6; h <= 23; h++) {
  const rate = h < 8 ? 1 : h < 10 ? 4 : h < 15 ? 2 : h < 18 ? 3 : h < 21 ? 5 : 2;
  for (let i = 0; i < rate; i++) {
    _add('lobby', 'guest_arrival', _mins(h, Math.floor(Math.random() * 60)), 0.45 + Math.random() * 0.25);
  }
}
_add('lobby', 'queue_forming',      _mins(9, 14),  0.62);
_add('lobby', 'queue_forming',      _mins(16, 42), 0.71);
_add('lobby', 'unattended_luggage', _mins(10, 32), 0.68, 'Suitcase left near column C2 for 7 min', { x: 38, y: 48, w: 14, h: 22 });
_add('lobby', 'loitering_lobby',    _mins(14, 18), 0.54);
_add('lobby', 'loitering_lobby',    _mins(20, 7),  0.58);

// Corridors — steady traffic
for (let h = 7; h <= 23; h++) {
  for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
    _add('corridor_1', 'hallway_traffic', _mins(h, Math.floor(Math.random() * 60)), 0.42 + Math.random() * 0.2);
    _add('corridor_2', 'hallway_traffic', _mins(h, Math.floor(Math.random() * 60)), 0.42 + Math.random() * 0.2);
  }
}
_add('corridor_1', 'cart_in_corridor', _mins(10, 0), 0.62);
_add('corridor_1', 'cart_in_corridor', _mins(11, 15), 0.55);
_add('corridor_2', 'door_ajar',        _mins(11, 48), 0.61, 'Room 214 door ajar for 12 min', { x: 18, y: 30, w: 22, h: 48 });
_add('corridor_1', 'door_ajar',        _mins(15, 22), 0.58);

// Pool — daytime activity
for (let h = 9; h <= 19; h++) {
  for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
    _add('pool', 'pool_occupancy', _mins(h, Math.floor(Math.random() * 60)), 0.48 + Math.random() * 0.2);
  }
}
_add('pool', 'child_unsupervised',   _mins(15, 34), 0.69, 'Child (~5y) at shallow end, no adult visible in FoV for 42s', { x: 42, y: 55, w: 10, h: 18 });
_add('pool', 'person_in_pool_closed', _mins(23, 18), 0.74, 'Two silhouettes entering pool area after closing', { x: 30, y: 40, w: 40, h: 35 });

// Parking
for (let h = 0; h <= 23; h++) {
  const r = h < 6 ? 1 : h < 10 ? 4 : h < 14 ? 2 : h < 18 ? 3 : h < 22 ? 4 : 1;
  for (let i = 0; i < r; i++) _add('parking', 'vehicle_entry', _mins(h, Math.floor(Math.random() * 60)), 0.4 + Math.random() * 0.25);
}
_add('parking', 'stranger_loitering_lot', _mins(2, 42), 0.67, 'Individual moving between rows 3–5 for 6 min', { x: 25, y: 50, w: 15, h: 30 });
_add('parking', 'vehicle_blocking',       _mins(19, 4), 0.63);

// Bar — evening
for (let h = 17; h <= 23; h++) {
  for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
    _add('bar', 'bar_occupancy', _mins(h, Math.floor(Math.random() * 60)), 0.5 + Math.random() * 0.2);
  }
}
_add('bar', 'intoxicated_guest',   _mins(22, 48), 0.64, 'Guest unsteady near counter, assisted by staff');
_add('bar', 'aggressive_behavior', _mins(23, 22), 0.78, 'Raised voices + gesture, 2 subjects at table 4', { x: 48, y: 35, w: 28, h: 42 });

// Wellness
for (let h = 9; h <= 20; h++) {
  if (Math.random() > 0.4) _add('wellness', 'wellness_occupancy', _mins(h, Math.floor(Math.random() * 60)), 0.44 + Math.random() * 0.18);
}
_add('wellness', 'spa_after_hours', _mins(22, 6), 0.56);

// Gym
for (let h = 6; h <= 22; h++) {
  if (Math.random() > 0.5) _add('gym', 'wellness_occupancy', _mins(h, Math.floor(Math.random() * 60)), 0.44 + Math.random() * 0.18);
}

// Sort
const EVENTS = _EV.sort((a, b) => a.at - b.at);

// LLM response text (for a handful of escalated events)
const LLM_RESPONSES = {
  default: null,
};
// Attach synthesized LLM responses to escalated events
EVENTS.forEach(e => {
  if (!e.llm_triggered) return;
  const sig = SIGNALS.find(s => s.id === e.signal_id);
  if (e.signal_id === 'unattended_luggage') {
    e.llm = {
      verdict: 'confirmed',
      confidence: 0.82,
      text: 'A black hardshell suitcase is positioned approximately 2 meters from the reception desk, near column C2. No person is within a 3-meter radius. The item has been stationary for the full 7-minute observation window. **Recommended action:** dispatch staff to verify ownership.',
      model: 'claude-haiku-4-5',
      latency_ms: 840,
    };
  } else if (e.signal_id === 'child_unsupervised') {
    e.llm = {
      verdict: 'confirmed',
      confidence: 0.71,
      text: 'A child of approximately 5 years old is at the shallow end of the pool. No adult is visible within the frame for the past 42 seconds. Two adults are visible at loungers but are >8m away and facing the bar. **This matches the unsupervised-child criterion.** Recommend pool attendant check-in.',
      model: 'claude-haiku-4-5',
      latency_ms: 920,
    };
  } else if (e.signal_id === 'person_in_pool_closed') {
    e.llm = {
      verdict: 'confirmed',
      confidence: 0.88,
      text: 'Two individuals have entered the pool enclosure. Pool is closed since 22:00. Subjects appear to be adults, casually dressed (not in swimwear yet). **Security policy violation confirmed.** Consider direct intercom announcement before dispatching staff.',
      model: 'claude-haiku-4-5',
      latency_ms: 760,
    };
  } else if (e.signal_id === 'aggressive_behavior') {
    e.llm = {
      verdict: 'confirmed',
      confidence: 0.74,
      text: 'Two male subjects at table 4 are in a heated exchange. One has stood up and is gesturing sharply toward the other. Body language consistent with verbal altercation — no physical contact observed yet. **Immediate staff intervention advised.**',
      model: 'claude-haiku-4-5',
      latency_ms: 980,
    };
  } else if (e.signal_id === 'stranger_loitering_lot') {
    e.llm = {
      verdict: 'likely',
      confidence: 0.58,
      text: 'Single individual has walked between rows 3 and 5 of the parking lot over the past 6 minutes. No vehicle interaction observed, but subject has paused near 3 different cars. Not a guest check-in pattern. **Recommend monitoring; dispatch if behavior continues.**',
      model: 'claude-haiku-4-5',
      latency_ms: 870,
    };
  } else if (e.signal_id === 'door_ajar') {
    e.llm = {
      verdict: 'confirmed',
      confidence: 0.79,
      text: 'Guest room 214 door is standing open at ~60°. No person visible in corridor or within room doorway. Duration 12 minutes. **Likely housekeeping in progress** — cart not visible in current frame but was present 14 min ago.',
      model: 'claude-haiku-4-5',
      latency_ms: 720,
    };
  } else {
    e.llm = {
      verdict: 'likely',
      confidence: 0.55 + Math.random() * 0.2,
      text: `Vision model confirms the signal "${sig.text.toLowerCase()}" matches what's visible in the frame. Confidence is moderate. No immediate safety risk detected. **Recommend logging and continued monitoring.**`,
      model: 'claude-haiku-4-5',
      latency_ms: 700 + Math.floor(Math.random() * 400),
    };
  }
});

// Helpers
function signalById(id) { return SIGNALS.find(s => s.id === id); }
function areaById(id) { return AREAS.find(a => a.id === id); }

Object.assign(window, { SIGNALS, AREAS, EVENTS, signalById, areaById, _fmtT });
