// Growable typed-array vertex store shared by the shape and glyph batches: no per-vertex
// array allocation, no spread, and one subarray upload per flush.

export class VertexStore {
  constructor(floatsPerVertex, initialVertices = 4096) {
    this.stride = floatsPerVertex;
    this.data = new Float32Array(floatsPerVertex * initialVertices);
    this.length = 0;
  }

  reserve(vertexCount) {
    const needed = this.length + vertexCount * this.stride;
    if (needed <= this.data.length) return;
    let capacity = this.data.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Float32Array(capacity);
    grown.set(this.data.subarray(0, this.length));
    this.data = grown;
  }

  get vertexCount() {
    return this.length / this.stride;
  }

  view() {
    return this.data.subarray(0, this.length);
  }

  clear() {
    this.length = 0;
  }
}
