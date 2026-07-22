export const PRESETS = {
  blank: {
    label: 'Limpo',
    background: '#ffffff',
    colors: [{ color: '#111111', weight: 1 }],
  },
  tropical: {
    label: 'Tropical',
    background: '#0b3d2e',
    colors: [
      { color: '#ff6b6b', weight: 3 },
      { color: '#ffd166', weight: 3 },
      { color: '#06d6a0', weight: 2 },
      { color: '#f2f2f2', weight: 1 },
    ],
  },
  nordico: {
    label: 'Nórdico',
    background: '#eef1f4',
    colors: [
      { color: '#2b3a4a', weight: 3 },
      { color: '#8fb8de', weight: 3 },
      { color: '#d1495b', weight: 1 },
      { color: '#3d3d3d', weight: 2 },
    ],
  },
  terracota: {
    label: 'Terracota',
    background: '#f4e9dd',
    colors: [
      { color: '#c1502e', weight: 3 },
      { color: '#e0a458', weight: 3 },
      { color: '#5c3d2e', weight: 2 },
      { color: '#7d8c6c', weight: 1 },
    ],
  },
  oceano: {
    label: 'Oceano',
    background: '#08243a',
    colors: [
      { color: '#4cc9f0', weight: 3 },
      { color: '#0f6674', weight: 2 },
      { color: '#caf0f8', weight: 2 },
      { color: '#023e8a', weight: 2 },
    ],
  },
  monocromatico: {
    label: 'Monocromático',
    background: '#ffffff',
    colors: [
      { color: '#111111', weight: 3 },
      { color: '#4a4a4a', weight: 2 },
      { color: '#8a8a8a', weight: 2 },
      { color: '#cfcfcf', weight: 2 },
    ],
  },
  neon: {
    label: 'Neon',
    background: '#0a0a0a',
    colors: [
      { color: '#ff2fd0', weight: 2 },
      { color: '#00f5ff', weight: 2 },
      { color: '#c6ff00', weight: 2 },
      { color: '#7c3aed', weight: 2 },
    ],
  },
  sunset: {
    label: 'Sunset',
    background: '#2b1330',
    colors: [
      { color: '#ff5e5b', weight: 3 },
      { color: '#ff9f1c', weight: 3 },
      { color: '#ffd60a', weight: 2 },
      { color: '#c9184a', weight: 2 },
    ],
  },
  floresta: {
    label: 'Floresta',
    background: '#1b2a1e',
    colors: [
      { color: '#2d6a4f', weight: 3 },
      { color: '#74c69d', weight: 3 },
      { color: '#95753a', weight: 2 },
      { color: '#d8c9a3', weight: 1 },
    ],
  },
  pastel: {
    label: 'Pastel',
    background: '#fbf6f9',
    colors: [
      { color: '#ffc4d6', weight: 3 },
      { color: '#c4e0ff', weight: 3 },
      { color: '#d9c4ff', weight: 2 },
      { color: '#c4ffd9', weight: 2 },
    ],
  },
  urbano: {
    label: 'Urbano',
    background: '#2b2b2e',
    colors: [
      { color: '#9a9a9a', weight: 3 },
      { color: '#e4e4e4', weight: 2 },
      { color: '#f2601c', weight: 1 },
      { color: '#5a5a5e', weight: 2 },
    ],
  },
  vintage: {
    label: 'Vintage',
    background: '#e8dcc4',
    colors: [
      { color: '#a44a3f', weight: 3 },
      { color: '#c98a4b', weight: 2 },
      { color: '#5b7065', weight: 2 },
      { color: '#3c3229', weight: 1 },
    ],
  },
  acidico: {
    label: 'Ácido',
    background: '#1a2400',
    colors: [
      { color: '#c6ff00', weight: 3 },
      { color: '#6b8e00', weight: 2 },
      { color: '#eaffb0', weight: 1 },
      { color: '#2f3d00', weight: 2 },
    ],
  },
  amonia: {
    label: 'Amônia',
    background: '#eef7f2',
    colors: [
      { color: '#7fd8c4', weight: 3 },
      { color: '#2b8a72', weight: 2 },
      { color: '#d8f3e6', weight: 2 },
      { color: '#3d5a54', weight: 1 },
    ],
  },
  cromado: {
    label: 'Cromado',
    background: '#1c1e22',
    colors: [
      { color: '#b8bec7', weight: 3 },
      { color: '#6f7885', weight: 2 },
      { color: '#e8ecef', weight: 2 },
      { color: '#3a3f46', weight: 1 },
    ],
  },
  vulcanico: {
    label: 'Vulcânico',
    background: '#170606',
    colors: [
      { color: '#c1272d', weight: 3 },
      { color: '#ff6a00', weight: 2 },
      { color: '#3a0a0a', weight: 2 },
      { color: '#1a1a1a', weight: 1 },
    ],
  },
};

export function pickWeighted(rng, entries) {
  const total = entries.reduce((sum, e) => sum + (e.weight ?? 1), 0);
  let r = rng() * total;
  for (const entry of entries) {
    r -= entry.weight ?? 1;
    if (r <= 0) return entry.color;
  }
  return entries[entries.length - 1].color;
}

export function clonePreset(preset) {
  return {
    label: preset.label,
    background: preset.background,
    colors: preset.colors.map((c) => ({ ...c })),
  };
}
