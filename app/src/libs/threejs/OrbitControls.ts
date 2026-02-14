import {
  type Camera,
  EventDispatcher,
  type Matrix4,
  MOUSE,
  Quaternion,
  Spherical,
  TOUCH,
  Vector2,
  Vector3,
} from "three";

/**
 * Events emitted by {@link OrbitControls}
 */
type OrbitControlsEventMap = {
  change: object;
  start: object;
  end: object;
};

/**
 * Sub‑union of THREE cameras that exposes the fields used in this implementation.
 * (Right/left/top/bottom exist on {@link OrthographicCamera};
 *  zoom and fov exist on both Perspective & Ortho; updateProjectionMatrix exists on both.)
 * We keep them optional so TS doesn't complain when the control is attached to the
 * other camera flavour.
 */
export interface OrbitControllableCamera extends Camera {
  /** Orthographic frustum half‑width */
  right?: number;
  /** Orthographic frustum half‑height */
  top?: number;
  /** Orthographic frustum half‑width */
  left?: number;
  /** Orthographic frustum half‑height */
  bottom?: number;
  /** Camera zoom factor */
  zoom: number;
  /** Vertical field‑of‑view in degrees (perspective only) */
  fov?: number;
  /** Flag injected by Three when the camera is a perspective variant */
  isPerspectiveCamera?: boolean;
  /** Flag injected by Three when the camera is an orthographic variant */
  isOrthographicCamera?: boolean;
  /** Mandatory – implemented by both built‑in camera classes */
  updateProjectionMatrix(): void;
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

const CHANGE_EVENT = { type: "change" as const };
const START_EVENT = { type: "start" as const };
const END_EVENT = { type: "end" as const };

// Tiny epsilon used for the numerical stability check at the end of update()
const EPS = 1e-6;

/**
 * Discrete finite‑state‑machine used by the control.
 */
enum STATE {
  NONE = -1,
  ROTATE,
  DOLLY,
  PAN,
  TOUCH_ROTATE,
  TOUCH_PAN,
  TOUCH_DOLLY_PAN,
  TOUCH_DOLLY_ROTATE,
}

/**
 * Portable OrbitControls variant with built‑in pan clamping that works for both
 * perspective & orthographic cameras.
 *
 * It is purposefully a *clone* of the JS file from which it was ported – only
 * type annotations & a handful of minor refactors were applied.
 */
export class OrbitControls extends EventDispatcher<OrbitControlsEventMap> {
  /* Public configuration ---------------------------------------------------- */

  /** Enable / disable the entire controller */
  public enabled = true;

  /** Focal target the camera orbits around */
  public readonly target = new Vector3();

  /** Minimum & maximum panning extents (in local camera space) */
  public readonly minPan: Vector3;
  public readonly maxPan: Vector3;

  /** How far you can dolly in / out (perspective) */
  public minDistance = 0;
  public maxDistance = Infinity;

  /** How far you can zoom in / out (orthographic) */
  public minZoom = 0;
  public maxZoom = Infinity;

  /** Vertical orbit limits, in radians */
  public minPolarAngle = 0;
  public maxPolarAngle = Math.PI;

  /** Horizontal orbit limits, in radians */
  public minAzimuthAngle = -Infinity;
  public maxAzimuthAngle = Infinity;

  /** Enable inertial damping */
  public enableDamping = false;
  public dampingFactor = 0.05;

  /** Enable dolly / mouse‑wheel zoom */
  public enableZoom = true;
  public zoomSpeed = 1.0;

  /** Enable orbit rotation */
  public enableRotate = true;
  public rotateSpeed = 1.0;

  /** Enable panning */
  public enablePan = true;
  public panSpeed = 1.0;
  public screenSpacePanning = true; // if false, pan orthogonal to camera.up
  public keyPanSpeed = 7.0; // px/key‑press

  /** Automatic DVD‑logo style rotation */
  public autoRotate = false;
  public autoRotateSpeed = 2.0; // 30 s/turn @60FPS

  /** Keyboard mapping – change to taste */
  public readonly keys = {
    LEFT: "ArrowLeft",
    UP: "ArrowUp",
    RIGHT: "ArrowRight",
    BOTTOM: "ArrowDown",
  } as const;

  /** Mouse button mapping */
  public readonly mouseButtons = {
    LEFT: MOUSE.ROTATE,
    MIDDLE: MOUSE.DOLLY,
    RIGHT: MOUSE.PAN,
  } as const;

  /** Touch gesture mapping */
  public readonly touches = {
    ONE: TOUCH.PAN,
    TWO: TOUCH.DOLLY_PAN,
  } as {
    ONE: TOUCH.PAN | TOUCH.ROTATE;
    TWO: TOUCH.DOLLY_PAN | TOUCH.DOLLY_ROTATE;
  };

  /* Private state ----------------------------------------------------------- */

  private readonly target0: Vector3;
  private readonly position0: Vector3;
  private zoom0: number;

  private _domElementKeyEvents: HTMLElement | null = null;

  private state: STATE = STATE.NONE;

  // Spherical coordinates helper
  private readonly spherical = new Spherical();
  private readonly sphericalDelta = new Spherical();

  // Dolly / wheel scaling factor
  private scale = 1;

  private readonly panOffset = new Vector3();
  private zoomChanged = false;

  // Pointers
  private readonly pointers: PointerEvent[] = [];
  private readonly pointerPositions: Record<number, Vector2> = {};

  // Reusable vectors
  private readonly rotateStart = new Vector2();
  private readonly rotateEnd = new Vector2();
  private readonly rotateDelta = new Vector2();

  private readonly panStart = new Vector2();
  private readonly panEnd = new Vector2();
  private readonly panDelta = new Vector2();

  private readonly dollyStart = new Vector2();
  private readonly dollyEnd = new Vector2();
  private readonly dollyDelta = new Vector2();

  /**
   * @param object      – camera to control
   * @param domElement  – HTML element listening for user input
   */
  constructor(
    public readonly object: OrbitControllableCamera,
    public readonly domElement: HTMLElement,
  ) {
    super();

    // Validate required parameters
    if (!object) {
      throw new Error("OrbitControls: camera object is required");
    }
    if (!domElement) {
      throw new Error("OrbitControls: DOM element is required");
    }

    // Initialize up vector if it's missing (Three.js cameras should have this by default)
    if (!object.up) {
      console.warn(
        "OrbitControls: camera up vector not found, initializing with default Y-up",
      );
      object.up = new Vector3(0, 1, 0);
    }

    // Prevent 2‑finger browser scroll / zoom
    this.domElement.style.touchAction = "none";

    // Compute default pan bounds from the orthographic frustum when available
    const maxPanX = (this.object.right ?? 1) / 4;
    const maxPanY = (this.object.top ?? 1) / 4;

    this.minPan = new Vector3(-maxPanX, -maxPanY, 0);
    this.maxPan = new Vector3(maxPanX, maxPanY, 0);

    // Store reset snapshots --------------------------------------------------
    this.target0 = this.target.clone();
    this.position0 = this.object.position.clone();
    this.zoom0 = this.object.zoom;

    // Bind event listeners ---------------------------------------------------
    this.domElement.addEventListener("contextmenu", this.onContextMenu, false);
    this.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.domElement.addEventListener("pointercancel", this.onPointerCancel);
    this.domElement.addEventListener("wheel", this.onMouseWheel, { passive: false });

    // Force one update so the camera starts at the correct orientation
    this.update();
  }

  /* ----------------------------------------------------------------------- */
  /* Public API                                                               */
  /* ----------------------------------------------------------------------- */

  /** Current polar angle (phi) */
  getPolarAngle(): number {
    return this.spherical.phi;
  }

  /** Current azimuth angle (theta) */
  getAzimuthalAngle(): number {
    return this.spherical.theta;
  }

  /** Linear distance from camera to {@link target} */
  getDistance(): number {
    return this.object.position.distanceTo(this.target);
  }

  /** Start listening to arrow‑key events on the supplied element */
  listenToKeyEvents(domElement: HTMLElement): void {
    domElement.addEventListener("keydown", this.onKeyDown);
    this._domElementKeyEvents = domElement;
  }

  /** Stop listening to previously attached key events */
  stopListenToKeyEvents(): void {
    this._domElementKeyEvents?.removeEventListener("keydown", this.onKeyDown);
    this._domElementKeyEvents = null;
  }

  /** Save the current camera + target as the new 'home' for {@link reset} */
  saveState(): void {
    this.target0.copy(this.target);
    this.position0.copy(this.object.position);
    this.zoom0 = this.object.zoom;
  }

  /** Reset camera & target back to snapshot taken with {@link saveState} */
  reset(): void {
    this.target.copy(this.target0);
    this.object.position.copy(this.position0);
    this.object.zoom = this.zoom0;

    this.object.updateProjectionMatrix();
    this.dispatchEvent(CHANGE_EVENT);

    this.update();

    this.state = STATE.NONE;
  }

  /** Dispose all native event listeners */
  dispose(): void {
    this.domElement.removeEventListener("contextmenu", this.onContextMenu);
    this.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.domElement.removeEventListener("pointercancel", this.onPointerCancel);
    this.domElement.removeEventListener("wheel", this.onMouseWheel);
    this.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.domElement.removeEventListener("pointerup", this.onPointerUp);

    this._domElementKeyEvents?.removeEventListener("keydown", this.onKeyDown);
  }

  /**
   * **Main update loop** – must be called once per frame *after* any manual
   * mutations to {@link target} or camera position.
   *
   * @returns `true` if the camera pose changed (emits a `change` event)
   */
  update = (() => {
    const offset = new Vector3();
    let quat: Quaternion;
    let quatInverse: Quaternion;

    const lastPosition = new Vector3();
    const lastQuaternion = new Quaternion();

    const twoPI = 2 * Math.PI;

    return (): boolean => {
      // Safety check for object and its up property
      if (!this.object?.up) {
        console.warn("OrbitControls: camera object or up vector is undefined");
        return false;
      }

      // Initialize quaternions if not already done or if up vector changed
      if (!quat) {
        quat = new Quaternion().setFromUnitVectors(
          this.object.up,
          new Vector3(0, 1, 0),
        );
        quatInverse = quat.clone().invert();
      }

      const position = this.object.position;

      // Offset from target in world space
      offset.copy(position).sub(this.target);

      // Rotate into y‑up space so we can work with spherical coordinates
      offset.applyQuaternion(quat);
      this.spherical.setFromVector3(offset);

      // Auto‑rotate ----------------------------------------------------------
      if (this.autoRotate && this.state === STATE.NONE) {
        this.rotateLeft(this.getAutoRotationAngle());
      }

      // Apply inertial damping ---------------------------------------------
      if (this.enableDamping) {
        this.spherical.theta += this.sphericalDelta.theta * this.dampingFactor;
        this.spherical.phi += this.sphericalDelta.phi * this.dampingFactor;
      } else {
        this.spherical.theta += this.sphericalDelta.theta;
        this.spherical.phi += this.sphericalDelta.phi;
      }

      // Constrain azimuth ----------------------------------------------------
      let { minAzimuthAngle: min, maxAzimuthAngle: max } = this;
      if (Number.isFinite(min) && Number.isFinite(max)) {
        if (min < -Math.PI) min += twoPI;
        else if (min > Math.PI) min -= twoPI;

        if (max < -Math.PI) max += twoPI;
        else if (max > Math.PI) max -= twoPI;

        if (min <= max) {
          this.spherical.theta = Math.max(min, Math.min(max, this.spherical.theta));
        } else {
          // Interval wraps, split in two.
          this.spherical.theta =
            this.spherical.theta > (min + max) / 2
              ? Math.max(min, this.spherical.theta)
              : Math.min(max, this.spherical.theta);
        }
      }

      // Constrain polar (vertical) angle ------------------------------------
      this.spherical.phi = Math.max(
        this.minPolarAngle,
        Math.min(this.maxPolarAngle, this.spherical.phi),
      );
      this.spherical.makeSafe();

      // Dolly scaling --------------------------------------------------------
      this.spherical.radius *= this.scale;
      this.spherical.radius = Math.max(
        this.minDistance,
        Math.min(this.maxDistance, this.spherical.radius),
      );

      // Apply pan offset -----------------------------------------------------
      if (this.enableDamping) {
        this.target.addScaledVector(this.panOffset, this.dampingFactor);
      } else {
        this.target.add(this.panOffset);
      }
      // Clamp within user bounds (scaled by zoom so it feels natural)
      const zoomFactor = this.object.zoom - 1;
      this.target.clamp(
        this.minPan.clone().multiplyScalar(zoomFactor),
        this.maxPan.clone().multiplyScalar(zoomFactor),
      );

      // Compute new camera pose --------------------------------------------
      offset.setFromSpherical(this.spherical);
      offset.applyQuaternion(quatInverse);
      position.copy(this.target).add(offset);
      this.object.lookAt(this.target);

      // Decay deltas ---------------------------------------------------------
      if (this.enableDamping) {
        this.sphericalDelta.theta *= 1 - this.dampingFactor;
        this.sphericalDelta.phi *= 1 - this.dampingFactor;
        this.panOffset.multiplyScalar(1 - this.dampingFactor);
      } else {
        this.sphericalDelta.set(0, 0, 0);
        this.panOffset.set(0, 0, 0);
      }
      this.scale = 1;

      // Emit change event if something actually moved -----------------------
      if (
        this.zoomChanged ||
        lastPosition.distanceToSquared(this.object.position) > EPS ||
        8 * (1 - lastQuaternion.dot(this.object.quaternion)) > EPS
      ) {
        this.dispatchEvent(CHANGE_EVENT);
        lastPosition.copy(this.object.position);
        lastQuaternion.copy(this.object.quaternion);
        this.zoomChanged = false;
        return true;
      }

      return false;
    };
  })();

  /* ----------------------------------------------------------------------- */
  /* Internal helpers                                                         */
  /* ----------------------------------------------------------------------- */

  private getAutoRotationAngle(): number {
    return ((2 * Math.PI) / 60 / 60) * this.autoRotateSpeed; // 60fps default
  }

  private getZoomScale(): number {
    return 0.95 ** this.zoomSpeed;
  }

  // --- Rotate --------------------------------------------------------------

  private rotateLeft = (angle: number): void => {
    this.sphericalDelta.theta -= angle;
  };

  private rotateUp = (angle: number): void => {
    this.sphericalDelta.phi -= angle;
  };

  // --- Pan helpers ---------------------------------------------------------

  private panLeft = (() => {
    const v = new Vector3();
    return (distance: number, objectMatrix: Matrix4): void => {
      v.setFromMatrixColumn(objectMatrix, 0); // X column
      v.multiplyScalar(-distance);
      this.panOffset.add(v);
    };
  })();

  private panUp = (() => {
    const v = new Vector3();
    return (distance: number, objectMatrix: Matrix4): void => {
      if (this.screenSpacePanning) {
        v.setFromMatrixColumn(objectMatrix, 1); // Y column
      } else {
        // Safety check for this.object.up
        if (!this.object?.up) {
          console.warn(
            "OrbitControls: camera up vector is undefined, using Y axis as fallback",
          );
          v.set(0, 1, 0);
        } else {
          v.setFromMatrixColumn(objectMatrix, 0);
          v.crossVectors(this.object.up, v);
        }
      }
      v.multiplyScalar(distance);
      this.panOffset.add(v);
    };
  })();

  /** Core pan routine – deltaX / deltaY are in screen pixels */
  private pan = (() => {
    const offset = new Vector3();
    return (deltaX: number, deltaY: number): void => {
      const element = this.domElement;

      if (this.object.isPerspectiveCamera) {
        // perspective pan
        const position = this.object.position;
        offset.copy(position).sub(this.target);
        let targetDistance = offset.length();

        // half fov is top of screen
        targetDistance *= Math.tan(((this.object.fov ?? 0) * 0.5 * Math.PI) / 180);

        this.panLeft(
          (2 * deltaX * targetDistance) / element.clientHeight,
          this.object.matrix,
        );
        this.panUp(
          (2 * deltaY * targetDistance) / element.clientHeight,
          this.object.matrix,
        );
      } else if (this.object.isOrthographicCamera) {
        // orthographic pan
        const right = this.object.right ?? 1;
        const left = this.object.left ?? -1;
        const top = this.object.top ?? 1;
        const bottom = this.object.bottom ?? -1;
        this.panLeft(
          (deltaX * (right - left)) / this.object.zoom / element.clientWidth,
          this.object.matrix,
        );
        this.panUp(
          (deltaY * (top - bottom)) / this.object.zoom / element.clientHeight,
          this.object.matrix,
        );
      } else {
        console.warn("OrbitControls: unknown camera type – pan disabled.");
        this.enablePan = false;
      }
    };
  })();

  // --- Dolly helpers -------------------------------------------------------

  private dollyIn = (dollyScale: number): void => {
    if (this.object.isPerspectiveCamera) {
      this.scale *= dollyScale;
    } else if (this.object.isOrthographicCamera) {
      this.object.zoom = Math.max(
        this.minZoom,
        Math.min(this.maxZoom, this.object.zoom / dollyScale),
      );
      this.object.updateProjectionMatrix();
      this.zoomChanged = true;
    } else {
      console.warn("OrbitControls: unknown camera type – zoom disabled.");
      this.enableZoom = false;
    }
  };

  private dollyOut = (dollyScale: number): void => {
    if (this.object.isPerspectiveCamera) {
      this.scale /= dollyScale;
    } else if (this.object.isOrthographicCamera) {
      this.object.zoom = Math.max(
        this.minZoom,
        Math.min(this.maxZoom, this.object.zoom * dollyScale),
      );
      this.object.updateProjectionMatrix();
      this.zoomChanged = true;
    } else {
      console.warn("OrbitControls: unknown camera type – zoom disabled.");
      this.enableZoom = false;
    }
  };

  /* ----------------------------------------------------------------------- */
  /* Event handlers – pointer / mouse / touch / key                           */
  /* ----------------------------------------------------------------------- */

  // All handlers are arrow‑functions so we can easily `removeEventListener`.

  private onContextMenu = (event: MouseEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
  };

  // ----------------- Pointer ------------------------------------------------

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;

    if (this.pointers.length === 0) {
      this.domElement.setPointerCapture(event.pointerId);
      this.domElement.addEventListener("pointermove", this.onPointerMove);
      this.domElement.addEventListener("pointerup", this.onPointerUp);
    }

    this.addPointer(event);
    if (event.pointerType === "touch") this.onTouchStart(event);
    else this.onMouseDown(event as unknown as MouseEvent); // casting is safe – we only use shared fields
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (event.pointerType === "touch") this.onTouchMove(event);
    else this.onMouseMove(event as unknown as MouseEvent);
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.removePointer(event);

    if (this.pointers.length === 0) {
      this.domElement.releasePointerCapture(event.pointerId);
      this.domElement.removeEventListener("pointermove", this.onPointerMove);
      this.domElement.removeEventListener("pointerup", this.onPointerUp);
    }

    this.dispatchEvent(END_EVENT);
    this.state = STATE.NONE;
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.removePointer(event);
  };

  // ----------------- Mouse --------------------------------------------------

  private onMouseDown = (event: MouseEvent): void => {
    let mouseAction: MOUSE | -1;
    switch (event.button) {
      case 0:
        mouseAction = this.mouseButtons.LEFT;
        break;
      case 1:
        mouseAction = this.mouseButtons.MIDDLE;
        break;
      case 2:
        mouseAction = this.mouseButtons.RIGHT;
        break;
      default:
        mouseAction = -1;
    }

    switch (mouseAction) {
      case MOUSE.DOLLY:
        if (!this.enableZoom) return;
        this.handleMouseDownDolly(event);
        this.state = STATE.DOLLY;
        break;
      case MOUSE.ROTATE:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (!this.enablePan) return;
          this.handleMouseDownPan(event);
          this.state = STATE.PAN;
        } else {
          if (!this.enableRotate) return;
          this.handleMouseDownRotate(event);
          this.state = STATE.ROTATE;
        }
        break;
      case MOUSE.PAN:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (!this.enableRotate) return;
          this.handleMouseDownRotate(event);
          this.state = STATE.ROTATE;
        } else {
          if (!this.enablePan) return;
          this.handleMouseDownPan(event);
          this.state = STATE.PAN;
        }
        break;
      default:
        this.state = STATE.NONE;
    }

    if (this.state !== STATE.NONE) this.dispatchEvent(START_EVENT);
  };

  private onMouseMove = (event: MouseEvent): void => {
    switch (this.state) {
      case STATE.ROTATE:
        if (!this.enableRotate) return;
        this.handleMouseMoveRotate(event);
        break;
      case STATE.DOLLY:
        if (!this.enableZoom) return;
        this.handleMouseMoveDolly(event);
        break;
      case STATE.PAN:
        if (!this.enablePan) return;
        this.handleMouseMovePan(event);
        break;
    }
  };

  private onMouseWheel = (event: WheelEvent): void => {
    if (!this.enabled || !this.enableZoom || this.state !== STATE.NONE) return;
    event.preventDefault();
    this.dispatchEvent(START_EVENT);
    this.handleMouseWheel(event);
    this.dispatchEvent(END_EVENT);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || !this.enablePan) return;
    this.handleKeyDown(event);
  };

  // ----------------- Touch --------------------------------------------------

  private onTouchStart = (event: PointerEvent): void => {
    this.trackPointer(event);
    switch (this.pointers.length) {
      case 1:
        if (this.touches.ONE === TOUCH.ROTATE) {
          if (!this.enableRotate) return;
          this.handleTouchStartRotate();
          this.state = STATE.TOUCH_ROTATE;
        } else if (this.touches.ONE === TOUCH.PAN) {
          if (!this.enablePan) return;
          this.handleTouchStartPan();
          this.state = STATE.TOUCH_PAN;
        } else {
          this.state = STATE.NONE;
        }
        break;
      case 2:
        if (this.touches.TWO === TOUCH.DOLLY_PAN) {
          if (!this.enableZoom && !this.enablePan) return;
          this.handleTouchStartDollyPan();
          this.state = STATE.TOUCH_DOLLY_PAN;
        } else if (this.touches.TWO === TOUCH.DOLLY_ROTATE) {
          if (!this.enableZoom && !this.enableRotate) return;
          this.handleTouchStartDollyRotate();
          this.state = STATE.TOUCH_DOLLY_ROTATE;
        } else {
          this.state = STATE.NONE;
        }
        break;
      default:
        this.state = STATE.NONE;
    }
    if (this.state !== STATE.NONE) this.dispatchEvent(START_EVENT);
  };

  private onTouchMove = (event: PointerEvent): void => {
    this.trackPointer(event);
    switch (this.state) {
      case STATE.TOUCH_ROTATE:
        if (!this.enableRotate) return;
        this.handleTouchMoveRotate(event);
        this.update();
        break;
      case STATE.TOUCH_PAN:
        if (!this.enablePan) return;
        this.handleTouchMovePan(event);
        this.update();
        break;
      case STATE.TOUCH_DOLLY_PAN:
        if (!this.enableZoom && !this.enablePan) return;
        this.handleTouchMoveDollyPan(event);
        this.update();
        break;
      case STATE.TOUCH_DOLLY_ROTATE:
        if (!this.enableZoom && !this.enableRotate) return;
        this.handleTouchMoveDollyRotate(event);
        this.update();
        break;
      default:
        this.state = STATE.NONE;
    }
  };

  /* ----------------------------------------------------------------------- */
  /* Low‑level handlers – shared by multiple input paths                      */
  /* ----------------------------------------------------------------------- */

  private handleMouseDownRotate(event: MouseEvent): void {
    this.rotateStart.set(event.clientX, event.clientY);
  }

  private handleMouseDownDolly(event: MouseEvent): void {
    this.dollyStart.set(event.clientX, event.clientY);
  }

  private handleMouseDownPan(event: MouseEvent): void {
    this.panStart.set(event.clientX, event.clientY);
  }

  private handleMouseMoveRotate(event: MouseEvent): void {
    this.rotateEnd.set(event.clientX, event.clientY);
    this.rotateDelta
      .subVectors(this.rotateEnd, this.rotateStart)
      .multiplyScalar(this.rotateSpeed);
    const element = this.domElement;
    this.rotateLeft((2 * Math.PI * this.rotateDelta.x) / element.clientHeight);
    this.rotateUp((2 * Math.PI * this.rotateDelta.y) / element.clientHeight);
    this.rotateStart.copy(this.rotateEnd);
    this.update();
  }

  private handleMouseMoveDolly(event: MouseEvent): void {
    this.dollyEnd.set(event.clientX, event.clientY);
    this.dollyDelta.subVectors(this.dollyEnd, this.dollyStart);
    if (this.dollyDelta.y > 0) this.dollyOut(this.getZoomScale());
    else if (this.dollyDelta.y < 0) this.dollyIn(this.getZoomScale());
    this.dollyStart.copy(this.dollyEnd);
    this.update();
  }

  private handleMouseMovePan(event: MouseEvent): void {
    this.panEnd.set(event.clientX, event.clientY);
    this.panDelta.subVectors(this.panEnd, this.panStart).multiplyScalar(this.panSpeed);
    this.pan(this.panDelta.x, this.panDelta.y);
    this.panStart.copy(this.panEnd);
    this.update();
  }

  private handleMouseWheel(event: WheelEvent): void {
    if (event.deltaY < 0) this.dollyIn(this.getZoomScale());
    else if (event.deltaY > 0) this.dollyOut(this.getZoomScale());
    this.update();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    let needsUpdate = false;
    switch (event.code) {
      case this.keys.UP:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.rotateUp(
            (2 * Math.PI * this.rotateSpeed) / this.domElement.clientHeight,
          );
        } else {
          this.pan(0, this.keyPanSpeed);
        }
        needsUpdate = true;
        break;
      case this.keys.BOTTOM:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.rotateUp(
            (-2 * Math.PI * this.rotateSpeed) / this.domElement.clientHeight,
          );
        } else {
          this.pan(0, -this.keyPanSpeed);
        }
        needsUpdate = true;
        break;
      case this.keys.LEFT:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.rotateLeft(
            (2 * Math.PI * this.rotateSpeed) / this.domElement.clientHeight,
          );
        } else {
          this.pan(this.keyPanSpeed, 0);
        }
        needsUpdate = true;
        break;
      case this.keys.RIGHT:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.rotateLeft(
            (-2 * Math.PI * this.rotateSpeed) / this.domElement.clientHeight,
          );
        } else {
          this.pan(-this.keyPanSpeed, 0);
        }
        needsUpdate = true;
        break;
    }
    if (needsUpdate) {
      event.preventDefault();
      this.update();
    }
  }

  // ----------------- Touch helpers ----------------------------------------

  private handleTouchStartRotate(): void {
    if (this.pointers.length === 1 && this.pointers[0]) {
      this.rotateStart.set(this.pointers[0].pageX, this.pointers[0].pageY);
    } else if (this.pointers.length >= 2 && this.pointers[0] && this.pointers[1]) {
      const x = 0.5 * (this.pointers[0].pageX + this.pointers[1].pageX);
      const y = 0.5 * (this.pointers[0].pageY + this.pointers[1].pageY);
      this.rotateStart.set(x, y);
    }
  }

  private handleTouchStartPan(): void {
    if (this.pointers.length === 1 && this.pointers[0]) {
      this.panStart.set(this.pointers[0].pageX, this.pointers[0].pageY);
    } else if (this.pointers.length >= 2 && this.pointers[0] && this.pointers[1]) {
      const x = 0.5 * (this.pointers[0].pageX + this.pointers[1].pageX);
      const y = 0.5 * (this.pointers[0].pageY + this.pointers[1].pageY);
      this.panStart.set(x, y);
    }
  }

  private handleTouchStartDolly(): void {
    if (this.pointers[0] && this.pointers[1]) {
      const dx = this.pointers[0].pageX - this.pointers[1].pageX;
      const dy = this.pointers[0].pageY - this.pointers[1].pageY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      this.dollyStart.set(0, distance);
    }
  }

  private handleTouchStartDollyPan(): void {
    if (this.enableZoom) this.handleTouchStartDolly();
    if (this.enablePan) this.handleTouchStartPan();
  }

  private handleTouchStartDollyRotate(): void {
    if (this.enableZoom) this.handleTouchStartDolly();
    if (this.enableRotate) this.handleTouchStartRotate();
  }

  private handleTouchMoveRotate(event: PointerEvent): void {
    if (this.pointers.length === 1) {
      this.rotateEnd.set(event.pageX, event.pageY);
    } else {
      const position = this.getSecondPointerPosition(event);
      if (position) {
        const x = 0.5 * (event.pageX + position.x);
        const y = 0.5 * (event.pageY + position.y);
        this.rotateEnd.set(x, y);
      }
    }
    this.rotateDelta
      .subVectors(this.rotateEnd, this.rotateStart)
      .multiplyScalar(this.rotateSpeed);
    const element = this.domElement;
    this.rotateLeft((2 * Math.PI * this.rotateDelta.x) / element.clientHeight);
    this.rotateUp((2 * Math.PI * this.rotateDelta.y) / element.clientHeight);
    this.rotateStart.copy(this.rotateEnd);
  }

  private handleTouchMovePan(event: PointerEvent): void {
    if (this.pointers.length === 1) {
      this.panEnd.set(event.pageX, event.pageY);
    } else {
      const position = this.getSecondPointerPosition(event);
      if (position) {
        const x = 0.5 * (event.pageX + position.x);
        const y = 0.5 * (event.pageY + position.y);
        this.panEnd.set(x, y);
      }
    }
    this.panDelta.subVectors(this.panEnd, this.panStart).multiplyScalar(this.panSpeed);
    this.pan(this.panDelta.x, this.panDelta.y);
    this.panStart.copy(this.panEnd);
  }

  private handleTouchMoveDolly(event: PointerEvent): void {
    const position = this.getSecondPointerPosition(event);
    if (position) {
      const dx = event.pageX - position.x;
      const dy = event.pageY - position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      this.dollyEnd.set(0, distance);
      this.dollyDelta.set(0, (this.dollyEnd.y / this.dollyStart.y) ** this.zoomSpeed);
      this.dollyOut(this.dollyDelta.y);
      this.dollyStart.copy(this.dollyEnd);
    }
  }

  private handleTouchMoveDollyPan(event: PointerEvent): void {
    if (this.enableZoom) this.handleTouchMoveDolly(event);
    if (this.enablePan) this.handleTouchMovePan(event);
  }

  private handleTouchMoveDollyRotate(event: PointerEvent): void {
    if (this.enableZoom) this.handleTouchMoveDolly(event);
    if (this.enableRotate) this.handleTouchMoveRotate(event);
  }

  /* ----------------------------------------------------------------------- */
  /* Pointer bookkeeping                                                      */
  /* ----------------------------------------------------------------------- */

  private addPointer(event: PointerEvent): void {
    this.pointers.push(event);
  }

  private removePointer(event: PointerEvent): void {
    delete this.pointerPositions[event.pointerId];
    const index = this.pointers.findIndex((p) => p.pointerId === event.pointerId);
    if (index !== -1) this.pointers.splice(index, 1);
  }

  private trackPointer(event: PointerEvent): void {
    let pos = this.pointerPositions[event.pointerId];
    if (!pos) {
      pos = new Vector2();
      this.pointerPositions[event.pointerId] = pos;
    }
    pos.set(event.pageX, event.pageY);
  }

  private getSecondPointerPosition(event: PointerEvent): Vector2 | null {
    if (this.pointers.length < 2 || !this.pointers[0] || !this.pointers[1]) {
      return null;
    }

    const other =
      event.pointerId === this.pointers[0].pointerId
        ? this.pointers[1]
        : this.pointers[0];

    return this.pointerPositions[other.pointerId] || null;
  }
}
