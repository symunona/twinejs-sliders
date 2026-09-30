import {DisplayChangeEventDetail} from '../../custom-events';
import {startSlidersTransition} from '../../sliders/transitions';
import {CustomElement} from '../../util/custom-element';
import './page-transition.css';

export interface UpdateContentOptions {
  preserveWindowScroll?: boolean;
}

export class PageTransition extends CustomElement {
  connectedCallback() {
    window.addEventListener('display-change', this);
  }

  disconnectedCallback() {
    window.removeEventListener('display-change', this);
  }

  async startTransition(
    callback: () => void | Promise<void>,
    options: UpdateContentOptions = {}
  ) {
    // Sliders edit (see format/README.md): the swap, its transition (link, scene,
    // story default) and the wait for a new <sliders-stage> live in the Sliders layer.
    // Chapbook's crossfade / fadeInOut are still read there, as aliases.

    await startSlidersTransition(this, callback, options.preserveWindowScroll);
  }

  handleEvent({detail}: CustomEvent<DisplayChangeEventDetail>) {
    this.startTransition(() => {
      const bodyEl = this.querySelector('article');

      if (bodyEl) {
        // This <div> wrapper allows margin collapse between child elements to
        // occur, because the element uses flex display for vertical alignment.

        bodyEl.innerHTML = `<div>${detail.body}</div>`;

        // This event is used by <page-skip>, which decides whether to show a
        // skip indicator based on what the new content is.

        bodyEl.dispatchEvent(
          new CustomEvent('body-content-change', {bubbles: true})
        );
      }

      const parts = ['left', 'center', 'right'];

      for (const marginal of ['footer', 'header']) {
        const marginalEl = this.querySelector(marginal);

        if (!marginalEl) {
          continue;
        }

        if (
          parts.some(
            part =>
              detail[marginal as 'footer' | 'header'][
                part as 'left' | 'center' | 'right'
              ].trim() !== ''
          )
        ) {
          marginalEl.removeAttribute('hidden');
        } else {
          marginalEl.setAttribute('hidden', '');
        }

        marginalEl.innerHTML = ['left', 'center', 'right'].reduce(
          (result, part) =>
            result +
            `<div class="${part}">${
              detail[marginal as 'footer' | 'header'][
                part as 'left' | 'center' | 'right'
              ]
            }</div>`,
          ''
        );
      }
    });
  }
}
