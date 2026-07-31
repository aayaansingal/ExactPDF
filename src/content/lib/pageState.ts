/**
 * Temporary page modifications and their guaranteed undo.
 *
 * Every change made to a page during capture is recorded here and reversed by
 * {@link PageState.restore}, which the page controller calls on success,
 * cancellation and failure alike. The plan treats "temporary page changes are
 * always restored" as a release blocker, so restore is idempotent and never
 * throws: a half-restored page is worse than a failed capture.
 */

const STYLE_ELEMENT_ID = 'exactpdf-capture-style';

/**
 * Suppresses motion during capture so tiles photographed seconds apart line up.
 * Animations are paused rather than removed, which leaves elements at their
 * current frame instead of snapping them back to their initial state.
 */
const FREEZE_CSS = `
*, *::before, *::after {
  animation-play-state: paused !important;
  transition: none !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
`;

interface HiddenElement {
  readonly element: HTMLElement;
  readonly previousVisibility: string;
}

export class PageState {
  private scrollX = 0;
  private scrollY = 0;
  private frozen = false;
  private hidden: HiddenElement[] = [];
  private fixedElements: HTMLElement[] | null = null;
  private previousScrollBehavior = '';

  /** Records scroll position and stops animation. Safe to call repeatedly. */
  freeze(): void {
    if (this.frozen) {
      return;
    }
    this.scrollX = window.scrollX;
    this.scrollY = window.scrollY;
    this.previousScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';

    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = FREEZE_CSS;
    document.head.appendChild(style);
    this.frozen = true;
  }

  /**
   * Finds elements that stay put while the page scrolls.
   *
   * Detection is by computed position rather than by heuristics about class
   * names or size, and the result is cached: re-querying between tiles would
   * both cost a full style recalculation and risk picking up elements that
   * only became fixed because an earlier tile scrolled past a trigger point.
   */
  collectFixedElements(): HTMLElement[] {
    if (this.fixedElements !== null) {
      return this.fixedElements;
    }
    const found: HTMLElement[] = [];

    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const position = window.getComputedStyle(element).position;
      if (position !== 'fixed' && position !== 'sticky') {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        continue;
      }
      // A fixed element covering nearly the whole viewport is a modal or an
      // overlay backdrop, not a repeating header; hiding it would remove
      // content the user can see and expects to capture.
      if (rect.width * rect.height > window.innerWidth * window.innerHeight * 0.8) {
        continue;
      }
      found.push(element);
    }

    this.fixedElements = found;
    return found;
  }

  /** Hides sticky and fixed elements so they appear on the first tile only. */
  hideFixedElements(): void {
    for (const element of this.collectFixedElements()) {
      if (this.hidden.some((entry) => entry.element === element)) {
        continue;
      }
      this.hidden.push({ element, previousVisibility: element.style.visibility });
      element.style.setProperty('visibility', 'hidden', 'important');
    }
  }

  showFixedElements(): void {
    for (const { element, previousVisibility } of this.hidden) {
      if (previousVisibility === '') {
        element.style.removeProperty('visibility');
      } else {
        element.style.visibility = previousVisibility;
      }
    }
    this.hidden = [];
  }

  /** Reverses every change and returns the page to its original scroll offset. */
  restore(): void {
    try {
      this.showFixedElements();
    } catch {
      // Continue: a failure here must not prevent the scroll position from
      // being restored, which is the change the user would actually notice.
    }

    try {
      document.getElementById(STYLE_ELEMENT_ID)?.remove();
      if (this.frozen) {
        document.documentElement.style.scrollBehavior = this.previousScrollBehavior;
        if (this.previousScrollBehavior === '') {
          document.documentElement.style.removeProperty('scroll-behavior');
        }
      }
    } catch {
      // As above.
    }

    if (this.frozen) {
      window.scrollTo({ left: this.scrollX, top: this.scrollY, behavior: 'auto' });
    }
    this.frozen = false;
    this.fixedElements = null;
  }
}
