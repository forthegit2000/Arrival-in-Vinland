/**
 * World is the final interactive layer, extending InteriorWorld.
 * It owns district camera controls, selection, pointer gestures, and build ghosts.
 * onPlace requests an order from game.js; Simulation validates and spends stock.
 * A ghost or mesh is presentation state, not proof that construction exists.
 */
(function (root) {
  'use strict';

  const THREE = root.THREE;
  const Model = root.VinlandModel;
  // Real-time angular speeds: independent of simulation speed and frame rate.
  const ROTATION_SPEED = (15 * Math.PI) / 180;
  const FAST_ROTATION_SPEED = (30 * Math.PI) / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  class World extends root.VinlandWorld.ArrivalWorld {
    updateProjection() {
      if (!this.districtCamera) {
        return;
      }
      const half = this.distance * 0.35;
      const aspect = this.w / Math.max(1, this.h);
      Object.assign(this.districtCamera, {
        left: -half * aspect,
        right: half * aspect,
        top: half,
        bottom: -half,
      });
      this.districtCamera.updateProjectionMatrix();
    }

    resize() {
      super.resize();
      this.updateProjection();
    }

    sync() {
      super.sync();
      if (this.placing) {
        this.updateGhost();
      }
    }

    drawMap(canvas) {
      super.drawMap(canvas);
      if (this.view !== 'district') {
        return;
      }
      const context = canvas.getContext('2d');
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const ray = new THREE.Raycaster();
      context.strokeStyle = '#9ad5ff';
      context.lineWidth = 1.4;
      context.beginPath();
      for (const [i, xy] of [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ].entries()) {
        ray.setFromCamera(new THREE.Vector2(...xy), this.camera);
        const point = ray.ray.intersectPlane(plane, new THREE.Vector3());
        if (!point) {
          return;
        }
        const extent = this.mapExtent;
        const x = ((point.x - extent.minX) / extent.width) * canvas.width;
        const y = ((point.z - extent.minZ) / extent.depth) * canvas.height;
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.closePath();
      context.stroke();
    }

    center() {
      this.target.set(0, Model.elevation(0, 0, this.sim.state.config) + 1, 0);
      this.desiredAzimuth = Math.PI / 4;
      this.polar = Math.acos(1 / Math.sqrt(3));
      this.desiredDistance = this.w < 700 ? 160 : 210;
    }

    overviewDistance() {
      const span = this.mapExtent.width * Math.SQRT2;
      return (
        (Math.max(span / (this.w / Math.max(1, this.h)), span * Math.cos(this.polar) + 80) / 0.7) *
        1.12
      );
    }

    overview() {
      this.center();
      this.desiredDistance = this.overviewDistance();
    }

    rotateCamera(angle) {
      if (this.view === 'district') {
        this.desiredAzimuth += angle;
        // Follow held input directly; releasing it must stop the turn immediately.
        this.azimuth = this.desiredAzimuth;
      }
    }

    updateRotation(deltaSeconds) {
      const blocked =
        this.view !== 'district' ||
        document.body.dataset.screen === 'atlantic' ||
        document.querySelector('dialog[open], #title-screen:not([hidden])') ||
        document.activeElement?.matches('input,textarea,select');
      if (blocked) {
        this.heldRotationButtons.clear();
        for (const key of ['KeyQ', 'KeyE', 'KeyR', 'KeyT']) {
          this.keys.delete(key);
        }
        return;
      }
      let cameraDirection = Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));
      let buildingDirection = Number(this.keys.has('KeyR')) - Number(this.keys.has('KeyT'));
      for (const input of this.heldRotationButtons.values()) {
        if (input.control === 'camera') {
          cameraDirection += input.direction;
        } else {
          buildingDirection += input.direction;
        }
      }
      const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const angle = (fast ? FAST_ROTATION_SPEED : ROTATION_SPEED) * deltaSeconds;
      if (cameraDirection) {
        this.rotateCamera(clamp(cameraDirection, -1, 1) * angle);
      }
      if (buildingDirection && this.placing) {
        // Positive Y rotation is counterclockwise when viewed from above.
        this.rotatePlacement(-clamp(buildingDirection, -1, 1) * angle);
      }
    }

    zoomCamera(factor) {
      if (this.view !== 'walk') {
        this.desiredDistance = clamp(
          this.desiredDistance * factor,
          45,
          this.measuredTerrain ? this.overviewDistance() : 330,
        );
      }
    }

    panCamera(dx, dy) {
      const units = (this.distance * 0.7) / Math.max(1, this.h);
      const azimuth = this.azimuth;
      this.target.x -=
        units * (Math.cos(azimuth) * dx + (Math.sin(azimuth) * dy) / Math.cos(this.polar));
      this.target.z +=
        units * (Math.sin(azimuth) * dx - (Math.cos(azimuth) * dy) / Math.cos(this.polar));
      const limit = this.measuredTerrain ? this.mapExtent.width / 2 : 170;
      this.target.x = clamp(this.target.x, -limit, limit);
      this.target.z = clamp(this.target.z, -limit, limit);
      this.target.y = Model.elevation(this.target.x, this.target.z, this.sim.state.config) + 1;
    }

    setView(view) {
      if (view === this.view) {
        return;
      }
      const orbitAngle = this.desiredAzimuth;
      const previousCamera = this.camera;
      this.camera = view === 'walk' ? this.walkCamera : this.districtCamera;
      if (view === 'walk') {
        this.walkCamera.position.copy(previousCamera.position);
      }
      super.setView(view);
      if (view === 'walk') {
        this.orbitSaved.azimuth = orbitAngle;
      }
      if (view === 'district') {
        this.desiredAzimuth = this.azimuth;
        this.updateProjection();
      }
      this.resize();
    }

    selectObject(object) {
      this.clearSelection();
      if (!object) {
        return;
      }
      this.selectedObject = object;
      this.selectionMarker = new THREE.Box3Helper(new THREE.Box3(), 0x8dd6ff);
      this.selectionMarker.material.depthTest = false;
      this.selectionMarker.material.transparent = true;
      this.selectionMarker.material.opacity = 0.8;
      this.selectionMarker.renderOrder = 20;
      // Local bounds inherit the building's exact rotation and scale. BoxHelper
      // instead produces a world-axis-aligned box, even for a rotated building.
      object.add(this.selectionMarker);
      this.updateSelectionBounds();
    }

    updateSelectionBounds() {
      const object = this.selectedObject;
      object.updateWorldMatrix(true, true);
      const toLocal = new THREE.Matrix4().copy(object.matrixWorld).invert();
      const meshTransform = new THREE.Matrix4();
      const meshBounds = new THREE.Box3();
      const bounds = this.selectionMarker.box;
      bounds.makeEmpty();
      object.traverse((child) => {
        // The marker is a line helper, so it never contributes to its own bounds.
        if (!child.isMesh) {
          return;
        }
        if (!child.geometry.boundingBox) {
          child.geometry.computeBoundingBox();
        }
        meshTransform.multiplyMatrices(toLocal, child.matrixWorld);
        meshBounds.copy(child.geometry.boundingBox).applyMatrix4(meshTransform);
        bounds.union(meshBounds);
      });
    }

    clearSelection() {
      if (this.selectionMarker) {
        this.selectionMarker.removeFromParent();
        this.selectionMarker.geometry.dispose();
        this.selectionMarker.material.dispose();
      }
      this.selectedObject = null;
      this.selectionMarker = null;
    }

    updateGhost() {
      super.updateGhost();
      if (!this.placing) {
        return;
      }
      const placement = this.placing;
      const reason = this.sim.blockedReason(placement.type);
      placement.valid = placement.valid && !reason;
      this.ghost.children.forEach((object) =>
        object.material.color.set(placement.valid ? '#86d6ad' : '#f18d7c'),
      );
      this.onPlacementStatus?.(placement, reason);
    }

    bindControls() {
      const canvas = this.renderer.domElement;
      this.walkCamera = this.camera;
      this.districtCamera = new THREE.OrthographicCamera(
        -1,
        1,
        1,
        -1,
        0.5,
        this.measuredTerrain ? 10000 : 750,
      );
      this.camera = this.districtCamera;
      this.azimuth = this.desiredAzimuth = Math.PI / 4;
      this.polar = Math.acos(1 / Math.sqrt(3));
      this.distance = this.desiredDistance = 210;
      this.heldRotationButtons = new Map();
      this.pointers = new Map();
      this.hoverPoint = null;
      this.onCancel = () => {};
      canvas.style.cursor = 'default';
      const placementPoint = (event) => {
        const hit = this.pointFromMouse(event);
        if (!hit) {
          return;
        }
        this.hoverPoint = {
          x: hit.x,
          z: hit.z,
        };
        this.onHover?.(this.hoverPoint);
        if (this.placing) {
          this.placing.x = Math.round(hit.x / 2) * 2;
          this.placing.z = Math.round(hit.z / 2) * 2;
          this.updateGhost();
        }
      };
      canvas.addEventListener('pointerdown', (event) => {
        if (this.workerControls?.beginPointer(event)) {
          event.preventDefault();
          return;
        }
        if (![0, 1, 2].includes(event.button)) {
          return;
        }
        event.preventDefault();
        this.pointers.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
        this.pointer = {
          x: event.clientX,
          y: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          button: event.button,
          down: true,
          moved: false,
          multi: this.pointers.size > 1,
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing';
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          this.pinch = {
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            zoom: this.desiredDistance,
            mid: {
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
            },
          };
        }
      });
      canvas.addEventListener('pointermove', (event) => {
        if (this.workerControls?.movePointer(event)) {
          return;
        }
        const pointer = this.pointer;
        if (this.pointers.has(event.pointerId)) {
          this.pointers.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
        }
        if (this.pointers.size > 1) {
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const mid = {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
          };
          pointer.moved = true;
          pointer.multi = true;
          if (this.view === 'district' && this.pinch) {
            this.desiredDistance = clamp(
              (this.pinch.zoom * this.pinch.distance) / Math.max(1, d),
              45,
              330,
            );
            this.panCamera(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
            this.pinch.mid = mid;
          }
          return;
        }
        if (pointer.down) {
          const dx = event.clientX - pointer.lastX;
          const dy = event.clientY - pointer.lastY;
          if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) {
            pointer.moved = true;
          }
          if (pointer.moved && this.view === 'district') {
            this.panCamera(dx, dy);
          }
          pointer.lastX = event.clientX;
          pointer.lastY = event.clientY;
        } else {
          placementPoint(event);
        }
      });
      canvas.addEventListener('pointerup', (event) => {
        if (this.workerControls?.endPointer(event)) {
          return;
        }
        const pointer = this.pointer;
        this.pointers.delete(event.pointerId);
        pointer.down = this.pointers.size > 0;
        if (pointer.down) {
          pointer.multi = true;
          pointer.moved = true;
          const next = [...this.pointers.values()][0];
          pointer.lastX = next.x;
          pointer.lastY = next.y;
          return;
        }
        canvas.style.cursor = this.placing ? 'crosshair' : 'default';
        this.pinch = null;
        if (pointer.moved || pointer.multi) {
          return;
        }
        if (event.button === 2) {
          if (
            !this.placing &&
            this.view === 'district' &&
            this.workerControls?.groundCommand(event)
          ) {
            return;
          }
          this.onCancel();
          return;
        }
        if (event.button !== 0) {
          return;
        }
        placementPoint(event);
        if (this.placing) {
          if (this.placing.valid) {
            this.onPlace({
              ...this.placing,
            });
          } else {
            this.onInvalid();
          }
          return;
        }
        this.pointFromMouse(event);
        const hits = this.raycaster.intersectObjects(this.scene.children, true);
        for (const hit of hits) {
          let object = hit.object;
          if (object.userData.room) {
            this.selectObject(this.hall);
            this.onSelect('room', object.userData.room);
            return;
          }
          while (object) {
            if (object.userData.hall) {
              this.selectObject(this.hall);
              this.onSelect('hall');
              return;
            }
            if (object.userData.select) {
              const type = object.userData.select;
              const id =
                type === 'ship' || type === 'livestock-ship'
                  ? this.ships.indexOf(object)
                  : type === 'tent'
                    ? this.tents.indexOf(object)
                    : object.userData.buildingId;
              this.selectObject(object);
              this.onSelect(type, id);
              return;
            }
            object = object.parent;
          }
        }
        this.clearSelection();
        this.onClearSelection?.();
      });
      canvas.addEventListener('pointercancel', (event) => {
        this.workerControls?.cancelDrag();
        this.pointers.delete(event.pointerId);
        this.pointer.down = false;
        this.pointer.moved = true;
        this.pinch = null;
        canvas.style.cursor = this.placing ? 'crosshair' : 'default';
      });
      canvas.addEventListener('contextmenu', (event) => event.preventDefault());
      canvas.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault();
          this.zoomCamera(Math.exp(clamp(event.deltaY, -250, 250) * 0.0015));
          if (this.placing) {
            placementPoint(event);
          }
        },
        {
          passive: false,
        },
      );
    }

    update(deltaSeconds) {
      this.updateRotation(deltaSeconds);
      if (this.view === 'district') {
        this.azimuth += (this.desiredAzimuth - this.azimuth) * Math.min(1, deltaSeconds * 9);
        if (
          !document.querySelector('dialog[open]') &&
          !document.activeElement?.matches('input,textarea,select')
        ) {
          const { forward, right } = this.readMovementInput();
          const speed =
            (this.distance * 0.35 * deltaSeconds) / Math.max(1, Math.hypot(forward, right));
          const azimuth = this.azimuth;
          const limit = this.measuredTerrain ? this.mapExtent.width / 2 : 170;
          this.target.x = clamp(
            this.target.x + (-Math.sin(azimuth) * forward + Math.cos(azimuth) * right) * speed,
            -limit,
            limit,
          );
          this.target.z = clamp(
            this.target.z + (-Math.cos(azimuth) * forward - Math.sin(azimuth) * right) * speed,
            -limit,
            limit,
          );
          this.target.y = Model.elevation(this.target.x, this.target.z, this.sim.state.config) + 1;
        }
        this.updateProjection();
      }
      super.update(deltaSeconds);
      if (this.selectionMarker) {
        if (this.selectedObject.parent && this.selectedObject.visible) {
          this.updateSelectionBounds();
        } else {
          this.clearSelection();
        }
      }
    }

    destroy() {
      this.clearSelection();
      super.destroy();
    }
  }
  root.VinlandWorld.World = World;
})(window);
