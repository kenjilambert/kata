export class LayerStack {
  constructor() {
    this.layers = [];
  }

  add(moduleInstance, { opacity = 1 } = {}) {
    const layer = { moduleInstance, opacity };
    this.layers.push(layer);
    return layer;
  }

  remove(layer) {
    this.layers = this.layers.filter((l) => l !== layer);
  }

  clear() {
    this.layers = [];
  }
}
