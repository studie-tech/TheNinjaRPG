/* TrackballControls.ts
 * Type-safe port of the three-js TrackballControls helper
 * Author: Mathias Gruber (https://github.com/mathiasgruber)
 */

import {
  type Camera,
  EventDispatcher,
  MOUSE,
  type OrthographicCamera,
  type PerspectiveCamera,
  Quaternion,
  Vector2,
  Vector3,
} from "three";

/* ------------------------------------------------------------------------- */
/* Helpers & internal types                                                  */
/* ------------------------------------------------------------------------- */

interface Screen {
  left: number;
  top: number;
  width: number;
  height: number;
}

enum STATE {
  NONE = -1,
  ROTATE = 0,
  ZOOM = 1,
  PAN = 2,
  TOUCH_ROTATE = 3,
  TOUCH_ZOOM_PAN = 4,
}

type MouseButtons = { LEFT: number; MIDDLE: number; RIGHT: number };
type PointerMap = Record<string | number, Vector2>;

/**
 * Events emitted by {@link TrackballControls}
 */
type TrackballControlsEventMap = {
  change: object;
  start: object;
  end: object;
};

/* ------------------------------------------------------------------------- */
/* TrackballControls                                                         */
/* ------------------------------------------------------------------------- */

export class TrackballControls extends EventDispatcher<TrackballControlsEventMap> {
  /* Public API ------------------------------------------------------------ */

  readonly object: Camera;
  readonly domElement: HTMLElement;

  enabled = true;

  /** Rectangle of `domElement` in page-space, set by `handleResize()`        */
  readonly screen: Screen = { left: 0, top: 0, width: 0, height: 0 };

  rotateSpeed = 1.0;
  zoomSpeed = 1.2;
  panSpeed = 0.3;

  noRotate = false;
  noZoom = false;
  noPan = false;

  staticMoving = false;
  dynamicDampingFactor = 0.2;

  minDistance = 0;
  maxDistance = Infinity;

  keys: string[] = ["KeyA", "KeyS", "KeyD"];
  mouseButtons: MouseButtons = {
    LEFT: MOUSE.ROTATE,
    MIDDLE: MOUSE.DOLLY,
    RIGHT: MOUSE.PAN,
  };

  /** Current look-at target (mutable)                                       */
  readonly target = new Vector3();

  /* State saved by `reset()` --------------------------------------------- */

  private readonly target0 = this.target.clone();
  private readonly position0: Vector3;
  public readonly up0: Vector3;
  private zoom0: number;

  /* Internals ------------------------------------------------------------- */

  private readonly _eye = new Vector3();

  private _state: STATE = STATE.NONE;
  private _keyState: STATE = STATE.NONE;

  private _movePrev = new Vector2();
  private _moveCurr = new Vector2();
  private _lastAxis = new Vector3();
  private _lastAngle = 0;

  private _zoomStart = new Vector2();
  private _zoomEnd = new Vector2();

  private _panStart = new Vector2();
  private _panEnd = new Vector2();

  private _touchZoomDistanceStart = 0;
  private _touchZoomDistanceEnd = 0;

  private readonly _pointers: PointerEvent[] = [];
  private readonly _pointerPositions: PointerMap = {};

  /* Events ---------------------------------------------------------------- */

  private static readonly CHANGE_EVENT = { type: "change" as const };
  private static readonly START_EVENT = { type: "start" as const };
  private static readonly END_EVENT = { type: "end" as const };

  /* ----------------------------------------------------------------------- */
  /* Life-cycle                                                              */
  /* ----------------------------------------------------------------------- */

  constructor(object: Camera, domElement: HTMLElement) {
    super();

    this.object = object;
    this.domElement = domElement;

    // save original transform for reset()
    this.position0 = this.object.position.clone();
    this.up0 = this.object.up.clone();
    this.zoom0 = this._getZoom(this.object);

    this.domElement.style.touchAction = "none"; // disable browser gestures

    /* Register DOM listeners --------------------------------------------- */

    this.domElement.addEventListener("contextmenu", this._contextmenu);
    this.domElement.addEventListener("pointerdown", this._onPointerDown);
    this.domElement.addEventListener("pointercancel", this._onPointerCancel);
    this.domElement.addEventListener("wheel", this._onMouseWheel, {
      passive: false,
    });

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);

    /* Initial sizing / look-at ------------------------------------------- */

    this.handleResize();
    this.update(); // force initial sync
  }

  dispose(): void {
    /* Remove DOM listeners ------------------------------------------------ */
    this.domElement.removeEventListener("contextmenu", this._contextmenu);
    this.domElement.removeEventListener("pointerdown", this._onPointerDown);
    this.domElement.removeEventListener("pointercancel", this._onPointerCancel);
    this.domElement.removeEventListener("wheel", this._onMouseWheel);

    this.domElement.removeEventListener("pointermove", this._onPointerMove);
    this.domElement.removeEventListener("pointerup", this._onPointerUp);

    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
  }

  /* ----------------------------------------------------------------------- */
  /* Public methods                                                          */
  /* ----------------------------------------------------------------------- */

  /** Recalculate `screen` rect – call on resize                             */
  handleResize = (): void => {
    const box = this.domElement.getBoundingClientRect();
    const d = this.domElement.ownerDocument?.documentElement;
    if (!d) return;

    this.screen.left = box.left + window.pageXOffset - d.clientLeft;
    this.screen.top = box.top + window.pageYOffset - d.clientTop;
    this.screen.width = box.width;
    this.screen.height = box.height;
  };

  /** Apply accumulated user input & update camera                           */
  update = (): void => {
    const EPS = 1e-6;

    this._eye.subVectors(this.object.position, this.target);

    if (!this.noRotate) this._rotateCamera();
    if (!this.noZoom) this._zoomCamera();
    if (!this.noPan) this._panCamera();

    this.object.position.addVectors(this.target, this._eye);

    /* Camera-type specific handling ------------------------------------ */
    if (this._isPerspective(this.object)) {
      this._checkDistances();
      this.object.lookAt(this.target);
    } else if (this._isOrthographic(this.object)) {
      this.object.lookAt(this.target);
    } else {
      console.warn("TrackballControls: Unsupported camera type");
    }

    /* Fire change event only when moved -------------------------------- */
    if (
      this._lastPosition.distanceToSquared(this.object.position) > EPS ||
      this._lastZoom !== this._getZoom(this.object)
    ) {
      this.dispatchEvent(TrackballControls.CHANGE_EVENT);
      this._lastPosition.copy(this.object.position);
      this._lastZoom = this._getZoom(this.object);
    }
  };

  /** Restores camera and target to constructor state                       */
  reset = (): void => {
    this._state = STATE.NONE;
    this._keyState = STATE.NONE;

    this.target.copy(this.target0);
    this.object.position.copy(this.position0);
    this.object.up.copy(this.up0);

    if (this._isOrthographic(this.object) || this._isPerspective(this.object)) {
      this.object.zoom = this.zoom0;
      this.object.updateProjectionMatrix();
    }

    this._eye.subVectors(this.object.position, this.target);
    this.object.lookAt(this.target);

    this.dispatchEvent(TrackballControls.CHANGE_EVENT);
    this._lastPosition.copy(this.object.position);
    this._lastZoom = this._getZoom(this.object);
  };

  /* ----------------------------------------------------------------------- */
  /* Internal helpers                                                        */
  /* ----------------------------------------------------------------------- */

  private _lastPosition = new Vector3();
  private _lastZoom = 1;

  private _getZoom(camera: Camera): number {
    if (this._isPerspective(camera) || this._isOrthographic(camera)) {
      return camera.zoom;
    }
    return 1;
  }

  private _getMouseOnScreen = (pageX: number, pageY: number): Vector2 =>
    new Vector2(
      (pageX - this.screen.left) / this.screen.width,
      (pageY - this.screen.top) / this.screen.height,
    );

  private _getMouseOnCircle = (pageX: number, pageY: number): Vector2 =>
    new Vector2(
      (pageX - this.screen.width * 0.5 - this.screen.left) / (this.screen.width * 0.5),
      (this.screen.height + 2 * (this.screen.top - pageY)) / this.screen.width,
    );

  /* -- transform helpers -------------------------------------------------- */

  private _rotateCamera(): void {
    const moveDirection = new Vector3(
      this._moveCurr.x - this._movePrev.x,
      this._moveCurr.y - this._movePrev.y,
      0,
    );
    let angle = moveDirection.length();

    if (angle) {
      this._eye.copy(this.object.position).sub(this.target);

      /* Calculate rotation axis/angle ---------------------------------- */
      const eyeDirection = this._eye.clone().normalize();
      const objectUpDirection = this.object.up.clone().normalize();
      const objectSidewaysDirection = new Vector3()
        .crossVectors(objectUpDirection, eyeDirection)
        .normalize();

      objectUpDirection.setLength(this._moveCurr.y - this._movePrev.y);
      objectSidewaysDirection.setLength(this._moveCurr.x - this._movePrev.x);

      moveDirection.copy(objectUpDirection.add(objectSidewaysDirection));

      const axis = new Vector3().crossVectors(moveDirection, this._eye).normalize();

      angle *= this.rotateSpeed;
      const quaternion = new Quaternion().setFromAxisAngle(axis, angle);

      this._eye.applyQuaternion(quaternion);
      this.object.up.applyQuaternion(quaternion);

      this._lastAxis.copy(axis);
      this._lastAngle = angle;
    } else if (!this.staticMoving && this._lastAngle) {
      this._lastAngle *= Math.sqrt(1.0 - this.dynamicDampingFactor);
      this._eye.copy(this.object.position).sub(this.target);
      const quaternion = new Quaternion().setFromAxisAngle(
        this._lastAxis,
        this._lastAngle,
      );
      this._eye.applyQuaternion(quaternion);
      this.object.up.applyQuaternion(quaternion);
    }

    this._movePrev.copy(this._moveCurr);
  }

  private _zoomCamera(): void {
    let factor: number;

    if (this._state === STATE.TOUCH_ZOOM_PAN) {
      factor = this._touchZoomDistanceStart / this._touchZoomDistanceEnd;
      this._touchZoomDistanceStart = this._touchZoomDistanceEnd;
    } else {
      factor = 1.0 + (this._zoomEnd.y - this._zoomStart.y) * this.zoomSpeed;
      if (this.staticMoving) this._zoomStart.copy(this._zoomEnd);
      else
        this._zoomStart.y +=
          (this._zoomEnd.y - this._zoomStart.y) * this.dynamicDampingFactor;
    }

    if (factor !== 1.0 && factor > 0.0) {
      if (this._isPerspective(this.object)) {
        this._eye.multiplyScalar(factor);
      } else if (this._isOrthographic(this.object)) {
        this.object.zoom /= factor;
        this.object.updateProjectionMatrix();
      }
    }
  }

  private _panCamera(): void {
    const mouseChange = this._panEnd.clone().sub(this._panStart);

    if (mouseChange.lengthSq() === 0) return;

    if (this._isOrthographic(this.object)) {
      const scaleX =
        (this.object.right - this.object.left) /
        this.object.zoom /
        this.domElement.clientWidth;
      const scaleY =
        (this.object.top - this.object.bottom) /
        this.object.zoom /
        this.domElement.clientWidth;
      mouseChange.set(mouseChange.x * scaleX, mouseChange.y * scaleY);
    }

    mouseChange.multiplyScalar(this._eye.length() * this.panSpeed);

    const pan = new Vector3()
      .copy(this._eye)
      .cross(this.object.up)
      .setLength(mouseChange.x)
      .add(this.object.up.clone().setLength(mouseChange.y));

    this.object.position.add(pan);
    this.target.add(pan);

    if (this.staticMoving) {
      this._panStart.copy(this._panEnd);
    } else {
      this._panStart.add(
        mouseChange
          .subVectors(this._panEnd, this._panStart)
          .multiplyScalar(this.dynamicDampingFactor),
      );
    }
  }

  private _checkDistances(): void {
    if (this.noZoom && this.noPan) return;

    const eyeLengthSq = this._eye.lengthSq();

    if (eyeLengthSq > this.maxDistance * this.maxDistance) {
      this.object.position.addVectors(
        this.target,
        this._eye.setLength(this.maxDistance),
      );
      this._zoomStart.copy(this._zoomEnd);
    }

    if (eyeLengthSq < this.minDistance * this.minDistance) {
      this.object.position.addVectors(
        this.target,
        this._eye.setLength(this.minDistance),
      );
      this._zoomStart.copy(this._zoomEnd);
    }
  }

  /* ----------------------------------------------------------------------- */
  /* DOM event handlers (bound as class properties)                          */
  /* ----------------------------------------------------------------------- */

  private _contextmenu = (event: MouseEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
  };

  private _onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;

    if (this._pointers.length === 0) {
      this.domElement.setPointerCapture(event.pointerId);
      this.domElement.addEventListener("pointermove", this._onPointerMove);
      this.domElement.addEventListener("pointerup", this._onPointerUp);
    }

    this._addPointer(event);

    if (event.pointerType === "touch") this._onTouchStart(event);
    else this._onMouseDown(event);
  };

  private _onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (event.pointerType === "touch") this._onTouchMove(event);
    else this._onMouseMove(event);
  };

  private _onPointerUp = (event: PointerEvent): void => {
    if (!this.enabled) return;

    if (event.pointerType === "touch") this._onTouchEnd(event);
    else this._onMouseUp();

    this._removePointer(event);

    if (this._pointers.length === 0) {
      this.domElement.releasePointerCapture(event.pointerId);
      this.domElement.removeEventListener("pointermove", this._onPointerMove);
      this.domElement.removeEventListener("pointerup", this._onPointerUp);
    }
  };

  private _onPointerCancel = (event: PointerEvent): void => {
    this._removePointer(event);
  };

  private _onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;

    window.removeEventListener("keydown", this._onKeyDown);

    if (this._keyState !== STATE.NONE) return;
    if (event.code === this.keys[STATE.ROTATE] && !this.noRotate)
      this._keyState = STATE.ROTATE;
    else if (event.code === this.keys[STATE.ZOOM] && !this.noZoom)
      this._keyState = STATE.ZOOM;
    else if (event.code === this.keys[STATE.PAN] && !this.noPan)
      this._keyState = STATE.PAN;
  };

  private _onKeyUp = (): void => {
    if (!this.enabled) return;
    this._keyState = STATE.NONE;
    window.addEventListener("keydown", this._onKeyDown);
  };

  private _onMouseDown(event: PointerEvent): void {
    if (this._state === STATE.NONE) {
      switch (event.button) {
        case this.mouseButtons.LEFT:
          this._state = STATE.ROTATE;
          break;
        case this.mouseButtons.MIDDLE:
          this._state = STATE.ZOOM;
          break;
        case this.mouseButtons.RIGHT:
          this._state = STATE.PAN;
          break;
      }
    }

    const state = this._keyState !== STATE.NONE ? this._keyState : this._state;

    if (state === STATE.ROTATE && !this.noRotate) {
      this._moveCurr.copy(this._getMouseOnCircle(event.pageX, event.pageY));
      this._movePrev.copy(this._moveCurr);
    } else if (state === STATE.ZOOM && !this.noZoom) {
      this._zoomStart.copy(this._getMouseOnScreen(event.pageX, event.pageY));
      this._zoomEnd.copy(this._zoomStart);
    } else if (state === STATE.PAN && !this.noPan) {
      this._panStart.copy(this._getMouseOnScreen(event.pageX, event.pageY));
      this._panEnd.copy(this._panStart);
    }

    this.dispatchEvent(TrackballControls.START_EVENT);
  }

  private _onMouseMove(event: PointerEvent): void {
    const state = this._keyState !== STATE.NONE ? this._keyState : this._state;

    if (state === STATE.ROTATE && !this.noRotate) {
      this._movePrev.copy(this._moveCurr);
      this._moveCurr.copy(this._getMouseOnCircle(event.pageX, event.pageY));
    } else if (state === STATE.ZOOM && !this.noZoom) {
      this._zoomEnd.copy(this._getMouseOnScreen(event.pageX, event.pageY));
    } else if (state === STATE.PAN && !this.noPan) {
      this._panEnd.copy(this._getMouseOnScreen(event.pageX, event.pageY));
    }
  }

  private _onMouseUp(): void {
    this._state = STATE.NONE;
    this.dispatchEvent(TrackballControls.END_EVENT);
  }

  private _onMouseWheel = (event: WheelEvent): void => {
    if (!this.enabled || this.noZoom) return;

    event.preventDefault();

    switch (event.deltaMode) {
      case 2: // pages
        this._zoomStart.y -= event.deltaY * 0.025;
        break;
      case 1: // lines
        this._zoomStart.y -= event.deltaY * 0.01;
        break;
      default: // pixels
        this._zoomStart.y -= event.deltaY * 0.00025;
    }

    this.dispatchEvent(TrackballControls.START_EVENT);
    this.dispatchEvent(TrackballControls.END_EVENT);
  };

  /* -- touch helpers ------------------------------------------------------ */

  private _onTouchStart(event: PointerEvent): void {
    this._trackPointer(event);

    switch (this._pointers.length) {
      case 1:
        this._state = STATE.TOUCH_ROTATE;
        this._moveCurr.copy(this._getMouseOnCircle(event.pageX, event.pageY));
        this._movePrev.copy(this._moveCurr);
        break;

      default: {
        // 2+ touches  =>  zoom/pan
        this._state = STATE.TOUCH_ZOOM_PAN;

        const posA = this._pointers[0];
        const posB = this._pointers[1];
        if (!posA || !posB) break;

        const dx = posA.pageX - posB.pageX;
        const dy = posA.pageY - posB.pageY;
        this._touchZoomDistanceEnd = this._touchZoomDistanceStart = Math.hypot(dx, dy);

        const x = (posA.pageX + posB.pageX) / 2;
        const y = (posA.pageY + posB.pageY) / 2;
        this._panStart.copy(this._getMouseOnScreen(x, y));
        this._panEnd.copy(this._panStart);
        break;
      }
    }

    this.dispatchEvent(TrackballControls.START_EVENT);
  }

  private _onTouchMove(event: PointerEvent): void {
    this._trackPointer(event);

    switch (this._pointers.length) {
      case 1:
        this._movePrev.copy(this._moveCurr);
        this._moveCurr.copy(this._getMouseOnCircle(event.pageX, event.pageY));
        break;

      default: {
        const position = this._getSecondPointerPosition(event);
        if (!position) break;

        const dx = event.pageX - position.x;
        const dy = event.pageY - position.y;
        this._touchZoomDistanceEnd = Math.hypot(dx, dy);

        const x = (event.pageX + position.x) / 2;
        const y = (event.pageY + position.y) / 2;
        this._panEnd.copy(this._getMouseOnScreen(x, y));
        break;
      }
    }
  }

  private _onTouchEnd(event: PointerEvent): void {
    switch (this._pointers.length) {
      case 0:
        this._state = STATE.NONE;
        break;

      case 1:
        this._state = STATE.TOUCH_ROTATE;
        this._moveCurr.copy(this._getMouseOnCircle(event.pageX, event.pageY));
        this._movePrev.copy(this._moveCurr);
        break;

      case 2:
        this._state = STATE.TOUCH_ZOOM_PAN;
        for (const p of this._pointers) {
          if (p.pointerId !== event.pointerId) {
            const pos = this._pointerPositions[p.pointerId];
            if (pos) {
              this._moveCurr.copy(this._getMouseOnCircle(pos.x, pos.y));
              this._movePrev.copy(this._moveCurr);
            }
            break;
          }
        }
        break;
    }

    this.dispatchEvent(TrackballControls.END_EVENT);
  }

  /* -- pointer bookkeeping ------------------------------------------------ */

  private _addPointer(event: PointerEvent): void {
    this._pointers.push(event);
  }

  private _removePointer(event: PointerEvent): void {
    delete this._pointerPositions[event.pointerId];
    const idx = this._pointers.findIndex((p) => p.pointerId === event.pointerId);
    if (idx !== -1) this._pointers.splice(idx, 1);
  }

  private _trackPointer(event: PointerEvent): void {
    const pos = this._pointerPositions[event.pointerId] ?? new Vector2();
    pos.set(event.pageX, event.pageY);
    this._pointerPositions[event.pointerId] = pos;
  }

  private _getSecondPointerPosition(event: PointerEvent): Vector2 | null {
    const firstPointer = this._pointers[0];
    if (!firstPointer) return null;

    const pointer =
      event.pointerId === firstPointer.pointerId ? this._pointers[1] : firstPointer;

    if (!pointer) return null;

    return this._pointerPositions[pointer.pointerId] ?? null;
  }

  /* -- type guards -------------------------------------------------------- */

  private _isPerspective(cam: Camera): cam is PerspectiveCamera {
    return (cam as PerspectiveCamera).isPerspectiveCamera === true;
  }
  private _isOrthographic(cam: Camera): cam is OrthographicCamera {
    return (cam as OrthographicCamera).isOrthographicCamera === true;
  }
}
