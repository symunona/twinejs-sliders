import {go} from '../../actions';
import {createLoggers} from '../../logger';
import {passageNamed} from '../../story';
import {allChildInputsValid} from '../../util/all-child-inputs-valid';
import {InlineButton} from './inline-button';

const {warn} = createLoggers('passage-link');

/**
 * A link that displays another passage. If there are any invalid inputs in its
 * parent, navigation will not occur. It may be used outside of a
 * `<body-content>` or `<marginal-content>` element, in which case it will skip
 * input validation.
 *
 * Available as `<passage-link>`.
 */
export class PassageLink extends InlineButton {
  constructor() {
    super();
    this.addEventListener('click', () => {
      const target = this.getAttribute('to');
      const parent: HTMLElement | null = this.closest(
        'article, footer, header'
      );

      if (parent && !allChildInputsValid(parent)) {
        return;
      }

      if (target) {
        // Sliders edit (see format/README.md): a link to a passage that does not
        // exist is a dead click and a warning, not the end of the reading session.
        // `go()` throws on an unknown name, the throw reaches `window.onerror`, and
        // `<error-handler>` replaces the whole story with an error box -- one typo
        // in one `[[link]]` used to cost the reader everything they had read. Only
        // this miss is survivable; `go()`'s other throws still reach the screen.

        if (!passageNamed(target)) {
          warn(`There is no passage named "${target}". Not navigating.`);
          return;
        }

        // We dispatch this event so that listeners interested in what triggered
        // a passage navigation can see us.

        this.dispatchEvent(
          new CustomEvent('passage-navigate', {bubbles: true})
        );
        go(target);
      }
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'link');
  }
}
