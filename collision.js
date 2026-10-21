/** Ground-plane collision geometry. Metres; rotations follow Three.js around Y. */
(function (root) {
  'use strict';

  function circleIntersects(x, z, radius, shape) {
    if (shape.radius !== undefined) {
      return Math.hypot(x - shape.x, z - shape.z) < radius + shape.radius;
    }
    const cosine = Math.cos(shape.rotation || 0);
    const sine = Math.sin(shape.rotation || 0);
    const dx = x - shape.x;
    const dz = z - shape.z;
    const localX = cosine * dx - sine * dz;
    const localZ = sine * dx + cosine * dz;
    const outsideX = Math.max(0, Math.abs(localX) - shape.w / 2);
    const outsideZ = Math.max(0, Math.abs(localZ) - shape.d / 2);
    return outsideX * outsideX + outsideZ * outsideZ < radius * radius;
  }

  class SpatialIndex {
    constructor(cellSize = 4) {
      this.cellSize = cellSize;
      this.cells = new Map();
      this.entries = new Map();
    }

    keys(x, z, halfWidth, halfDepth = halfWidth) {
      const keys = [];
      for (
        let column = Math.floor((x - halfWidth) / this.cellSize);
        column <= Math.floor((x + halfWidth) / this.cellSize);
        column++
      ) {
        for (
          let row = Math.floor((z - halfDepth) / this.cellSize);
          row <= Math.floor((z + halfDepth) / this.cellSize);
          row++
        ) {
          keys.push(column + ':' + row);
        }
      }
      return keys;
    }

    set(id, shape) {
      this.remove(id);
      const cosine = Math.abs(Math.cos(shape.rotation || 0));
      const sine = Math.abs(Math.sin(shape.rotation || 0));
      const halfWidth = shape.radius ?? (cosine * shape.w + sine * shape.d) / 2;
      const halfDepth = shape.radius ?? (sine * shape.w + cosine * shape.d) / 2;
      const keys = this.keys(shape.x, shape.z, halfWidth, halfDepth);
      this.entries.set(id, { shape: { ...shape }, keys });
      for (const key of keys) {
        if (!this.cells.has(key)) this.cells.set(key, new Set());
        this.cells.get(key).add(id);
      }
    }

    remove(id) {
      const entry = this.entries.get(id);
      if (!entry) return;
      for (const key of entry.keys) {
        const cell = this.cells.get(key);
        cell.delete(id);
        if (!cell.size) this.cells.delete(key);
      }
      this.entries.delete(id);
    }

    blocked(x, z, radius, ignoreId) {
      const checked = new Set();
      for (const key of this.keys(x, z, radius)) {
        for (const id of this.cells.get(key) || []) {
          if (id === ignoreId || checked.has(id)) continue;
          checked.add(id);
          if (circleIntersects(x, z, radius, this.entries.get(id).shape)) return true;
        }
      }
      return false;
    }
  }

  const collision = { circleIntersects, SpatialIndex };
  if (typeof module !== 'undefined') module.exports = collision;
  else root.VinlandCollision = collision;
})(typeof window !== 'undefined' ? window : globalThis);
