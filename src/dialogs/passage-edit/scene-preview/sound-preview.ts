/**
 * The Sounds tab's Preview: play what is heard at the scrubber, on demand.
 *
 * Its own `<audio>` elements, not the stage's deck. The deck plays STATE and follows the
 * scrubber; an audition is a gesture with a start and a stop, and must not be undone by the
 * next reparse. The stage is muted while one runs, so the two never play over each other.
 *
 * What plays: every music track in effect at the scrubber (Step 0 = the scene's own), and
 * the beat's `sfx:` once. A looping track (`loop: true` or a section) loops until Stop; a
 * counted loop plays once here. Ended = every non-looping sound played out.
 */

import * as React from 'react';
import type {AssetResolver, StageMusic, StageSound} from '@sliders/scene-types';

export interface PreviewSound {
	id: string;
	amount: number;
	loop: boolean;
	start?: number;
}

/** What Preview plays at this point of the scene. Empty = nothing to hear. */
export function previewSounds(
	music: StageMusic | undefined,
	sfx: StageSound | undefined
): PreviewSound[] {
	const out: PreviewSound[] = Object.values(music ?? {})
		.filter(track => !!track?.id)
		.map(track => ({
			amount: track.amount,
			id: track.id,
			loop: track.loop === true || typeof track.loop === 'object',
			start: track.start
		}));

	if (sfx?.id) {
		out.push({amount: sfx.amount, id: sfx.id, loop: false});
	}

	return out;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}

export interface SoundPreview {
	playing: boolean;
	play: (sounds: PreviewSound[]) => void;
	stop: () => void;
}

/**
 * One audition at a time. `muted` silences it without stopping it, like the stage's mute.
 * Unmount stops everything: a closed preview cannot keep playing.
 */
export function useSoundPreview(
	assets: AssetResolver,
	muted: boolean
): SoundPreview {
	const [playing, setPlaying] = React.useState(false);
	const elements = React.useRef<HTMLAudioElement[]>([]);
	/** Bumped by every play and stop, so a URL landing late knows it was overtaken. */
	const run = React.useRef(0);
	const mutedRef = React.useRef(muted);

	mutedRef.current = muted;

	const stop = React.useCallback(() => {
		run.current++;

		for (const el of elements.current) {
			el.pause();
			el.removeAttribute('src');
		}

		elements.current = [];
		setPlaying(false);
	}, []);

	const play = React.useCallback(
		(sounds: PreviewSound[]) => {
			stop();

			if (sounds.length === 0) {
				return;
			}

			const mine = ++run.current;
			let open = sounds.filter(sound => !sound.loop).length;
			let looping = 0;
			const done = () => {
				open--;

				if (run.current === mine && open <= 0 && looping === 0) {
					stop();
				}
			};

			setPlaying(true);

			void Promise.all(
				sounds.map(async sound => {
					const url = await assets.url(sound.id).catch(() => undefined);

					if (run.current !== mine) {
						return;
					}

					if (!url) {
						if (!sound.loop) {
							done();
						}

						return;
					}

					const el = new Audio(url);

					el.loop = sound.loop;
					el.volume = clamp01(sound.amount);
					el.muted = mutedRef.current;

					if (sound.start) {
						try {
							el.currentTime = sound.start;
						} catch {
							// Not seekable yet. From 0 beats silence.
						}
					}

					if (sound.loop) {
						looping++;
					} else {
						el.addEventListener('ended', done);
					}

					elements.current.push(el);

					try {
						await el.play();
					} catch {
						// Refused or unplayable: count it as played out.
						if (sound.loop) {
							looping--;
							open++;
						}

						done();
					}
				})
			).then(() => {
				// Nothing resolved at all: nothing is playing.
				if (run.current === mine && elements.current.length === 0) {
					stop();
				}
			});
		},
		[assets, stop]
	);

	React.useEffect(() => {
		for (const el of elements.current) {
			el.muted = muted;
		}
	}, [muted]);

	React.useEffect(() => stop, [stop]);

	return {play, playing, stop};
}
