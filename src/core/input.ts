// Keyboard and mouse state, polled once per frame by gameplay and the camera.
// Typing into an <input> or <textarea> never reaches the game.

export type MouseButton = 0 | 1 | 2;

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private buttons = new Set<number>();
  private buttonsPressed = new Set<number>();
  private buttonsReleased = new Set<number>();
  private pointerId: number | null = null;
  /** Keep the gesture's origin until contextmenu, which can follow pointerup on Windows. */
  private suppressContextMenu = false;
  /** Mouse movement since the last endFrame(), in CSS pixels. */
  dx = 0;
  dy = 0;
  /** Wheel delta since the last endFrame() (positive = zoom out). */
  wheel = 0;
  mouseX = 0;
  mouseY = 0;
  /** Distance the mouse travelled while a button was held, to tell clicks from drags. */
  dragDistance = 0;
  enabled = true;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointercancel', this.onPointerCancel);
    target.addEventListener('lostpointercapture', this.onLostPointerCapture);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', this.onContextMenu, true);
  }

  /** `code` is a KeyboardEvent.code, e.g. 'KeyW', 'Space', 'Digit1', 'Tab', 'Escape'. */
  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }
  wasPressed(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }
  wasReleased(code: string): boolean {
    return this.released.has(code);
  }
  isButtonDown(b: MouseButton): boolean {
    return this.enabled && this.buttons.has(b);
  }
  wasButtonPressed(b: MouseButton): boolean {
    return this.enabled && this.buttonsPressed.has(b);
  }
  wasButtonReleased(b: MouseButton): boolean {
    return this.buttonsReleased.has(b);
  }
  /** A press and release without much movement in between. */
  wasClicked(b: MouseButton): boolean {
    return this.buttonsReleased.has(b) && this.dragDistance < 6;
  }

  /** Call at the end of every frame after everything has read the input. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.buttonsPressed.clear();
    if (this.buttonsReleased.size) this.dragDistance = 0;
    this.buttonsReleased.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }

  dispose(): void {
    this.onBlur();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.target.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    this.target.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContextMenu, true);
  }

  private typing(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.typing(e)) return;
    // Focused UI controls own activation and focus traversal, rather than also jumping,
    // changing combat targets or toggling speech bubbles behind the reading window.
    const target = e.target;
    if (target instanceof Element && target.closest('button,a[href],select,summary') &&
      ['Tab', 'Enter', 'NumpadEnter', 'Space'].includes(e.code)) return;
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.down.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    this.released.add(e.code);
  };
  private readonly onBlur = (): void => {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.buttons.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
    this.dx = this.dy = this.wheel = this.dragDistance = 0;
    this.suppressContextMenu = false;
    this.releasePointer();
  };
  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.onBlur();
  };
  private releasePointer(): void {
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null && this.target.hasPointerCapture(id)) this.target.releasePointerCapture(id);
  }
  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.onBlur();
  };
  private readonly onLostPointerCapture = (e: PointerEvent): void => {
    // Normal pointerup also drops capture; it must not clear a still-held movement key.
    if (e.pointerId === this.pointerId && this.buttons.size) this.onBlur();
  };
  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.target.contains(e.target as Node) || this.suppressContextMenu || this.buttons.has(2)) {
      e.preventDefault();
    }
    this.suppressContextMenu = false;
  };
  private readonly onPointerDown = (e: PointerEvent): void => {
    const onTarget = this.target.contains(e.target as Node);
    // A new click on UI owns its normal menu, even after an earlier canvas drag.
    this.suppressContextMenu = onTarget && e.button === 2;
    if (!onTarget) return;
    this.buttons.add(e.button);
    this.buttonsPressed.add(e.button);
    this.dragDistance = 0;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.pointerId = e.pointerId;
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic event or an already-cancelled pointer has no active pointer to capture.
    }
  };
  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    if (this.buttons.delete(e.button)) this.buttonsReleased.add(e.button);
    if (!this.buttons.size) this.releasePointer();
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    // If the release happened outside the window, the next mouse move reports the truth.
    if (e.pointerType === 'mouse' && this.buttons.size) {
      for (const button of this.buttons) {
        const mask = button === 0 ? 1 : button === 2 ? 2 : button === 1 ? 4 : 1 << button;
        if (!(e.buttons & mask)) {
          this.buttons.delete(button);
          this.buttonsPressed.delete(button);
        }
      }
      if (!this.buttons.size) {
        this.dx = this.dy = 0;
        this.releasePointer();
      }
    }
    const dx = e.clientX - this.mouseX;
    const dy = e.clientY - this.mouseY;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (this.buttons.size) {
      this.dx += dx;
      this.dy += dy;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
    }
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) / 120;
  };
}
