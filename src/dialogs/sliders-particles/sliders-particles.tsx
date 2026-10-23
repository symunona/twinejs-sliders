/**
 * The Particles dialog: make and tune particle emitters.
 *
 * An emitter is an `fx` asset whose bytes are the particle sprite and whose `particles`
 * metadata is the emitter (`@sliders/scene-types` particles.ts). Nothing new is stored:
 * the asset store, sync and bundles carry it like any asset, and a scene places it by
 * name like a prop.
 *
 * Layout like the character editor: emitters across the top, a live preview, the knobs.
 */

import {
	DEFAULT_EMIT_BOX,
	EMIT_DEFAULTS,
	EMIT_PRESETS,
	emitBox,
	isVisualKind,
	resolveEmit,
	type AssetMeta,
	type EmitPatch,
	type Frac2,
	type ParticleSpec
} from '@sliders/scene-types';
import {uniqueName} from '@sliders/asset-store';
import {DEFAULT_ORIGIN} from '@sliders/render-dom';
import {IconPlayerPlay, IconPlus, IconTrash, IconWand} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {MenuButton} from '../../components/control/menu-button';
import {AdjustSlider} from '../asset-editor/adjust-slider';
import {DialogComponentProps} from '../dialogs.types';
import {useAssetLibrary} from '../sliders-assets/asset-store-context';
import {EmitControls} from './emit-controls';
import {ParticlePreview} from './particle-preview';
import './sliders-particles.css';

/** How long a change sits before it is written to the asset store. */
const SAVE_DELAY = 400;

/** The pack's sprites carry this tag (`scripts/particle-pack.ts`). */
export const PARTICLE_SPRITE_TAG = 'particle-sprite';

/** A soft white dot, for a library with no sprite at all yet. */
async function dotFile(): Promise<File> {
	const canvas = document.createElement('canvas');

	canvas.width = canvas.height = 64;

	const ctx = canvas.getContext('2d')!;
	const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);

	g.addColorStop(0, 'rgba(255,255,255,1)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 64, 64);

	const blob = await new Promise<Blob | null>(resolve =>
		canvas.toBlob(resolve, 'image/png')
	);

	return new File([blob ?? new Blob()], 'p-dot.png', {type: 'image/png'});
}

export type SlidersParticlesDialogProps = DialogComponentProps;

export const SlidersParticlesDialog: React.FC<SlidersParticlesDialogProps> = props => {
	const library = useAssetLibrary();
	const {store, refresh} = library;
	const {t} = useTranslation();
	const [selectedId, setSelectedId] = React.useState<string>();
	const [draft, setDraft] = React.useState<{id: string; spec: ParticleSpec; origin?: Frac2}>();
	const [urls, setUrls] = React.useState<Record<string, string | undefined>>({});
	const [restart, setRestart] = React.useState(0);
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const [error, setError] = React.useState<string>();

	const emitters = React.useMemo(
		() =>
			library.all
				.filter(asset => asset.particles)
				.sort((a, b) => a.name.localeCompare(b.name)),
		[library.all]
	);
	const sprites = React.useMemo(() => {
		const visual = library.all.filter(
			asset => isVisualKind(asset.kind) && !asset.particles && !asset.ownerCharacter
		);
		const tagged = visual.filter(asset => asset.tags.includes(PARTICLE_SPRITE_TAG));

		return (tagged.length ? tagged : visual).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
	}, [library.all]);
	const active: AssetMeta | undefined =
		emitters.find(asset => asset.id === selectedId) ?? emitters[0];

	// Urls for every thumbnail and the preview. Re-read when the library changes: a
	// sprite swap gives the emitter new bytes and a new url.
	React.useEffect(() => {
		let current = true;

		void Promise.all(
			[...emitters, ...sprites].map(
				async asset => [asset.id, await store.url(asset.id)] as const
			)
		).then(pairs => {
			if (current) {
				setUrls(Object.fromEntries(pairs));
			}
		});

		return () => {
			current = false;
		};
	}, [emitters, sprites, store]);

	// The draft follows the selection; edits happen on it and are written on a debounce.
	React.useEffect(() => {
		if (active && draft?.id !== active.id) {
			setDraft({id: active.id, origin: active.origin, spec: active.particles ?? {}});
		} else if (!active && draft) {
			setDraft(undefined);
		}
	}, [active, draft]);

	const latest = React.useRef(draft);
	const dirty = React.useRef(false);

	latest.current = draft;

	const commit = React.useCallback(async () => {
		const now = latest.current;

		if (!now || !dirty.current) {
			return;
		}

		dirty.current = false;

		try {
			await store.update(now.id, {
				particles: now.spec,
				...(now.origin ? {origin: now.origin} : {})
			});
			refresh();
		} catch (caught) {
			setError((caught as Error).message);
		}
	}, [refresh, store]);

	React.useEffect(() => {
		if (!draft) {
			return;
		}

		const timeout = window.setTimeout(commit, SAVE_DELAY);

		return () => window.clearTimeout(timeout);
	}, [commit, draft]);

	// Flush on close: the debounce above cancels its write on unmount.
	const commitRef = React.useRef(commit);

	commitRef.current = commit;
	React.useEffect(() => () => void commitRef.current(), []);

	function edit(change: {spec?: EmitPatch & Pick<ParticleSpec, 'box'>; origin?: Frac2}) {
		setDraft(prev => {
			if (!prev) {
				return prev;
			}

			dirty.current = true;

			return {
				...prev,
				origin: change.origin ?? prev.origin,
				spec: {...prev.spec, ...change.spec}
			};
		});
	}

	async function spriteFile(sprite: AssetMeta | undefined): Promise<File> {
		const blob = sprite ? await store.get(sprite.id) : undefined;

		return blob
			? new File([blob], `${sprite!.name}.png`, {type: blob.type || 'image/png'})
			: dotFile();
	}

	async function handleCreate(preset: string) {
		const {box, origin, params, texture} = EMIT_PRESETS[preset];
		const sprite = sprites.find(asset => asset.name === texture) ?? sprites[0];

		setError(undefined);

		try {
			await commit();

			const name = uniqueName(preset, await store.takenNames());
			const created = await store.putAsset(await spriteFile(sprite), {
				allowDuplicate: true,
				kind: 'fx',
				name,
				...(origin ? {origin} : {}),
				particles: {...params, box: box ?? DEFAULT_EMIT_BOX},
				tags: ['particles']
			});

			setSelectedId(created.id);
			refresh();
		} catch (caught) {
			setError((caught as Error).message);
		}
	}

	async function handleSprite(sprite: AssetMeta) {
		if (!active) {
			return;
		}

		setError(undefined);

		try {
			await commit();
			await store.replace(active.id, await spriteFile(sprite));
			refresh();
		} catch (caught) {
			setError((caught as Error).message);
		}
	}

	async function handleDelete() {
		if (!active) {
			return;
		}

		dirty.current = false;
		setDraft(undefined);
		setSelectedId(undefined);

		try {
			await store.remove(active.id);
		} catch (caught) {
			setError((caught as Error).message);
		}

		refresh();
	}

	const spec = draft?.id === active?.id ? draft?.spec : active?.particles;
	const params = resolveEmit(spec, undefined);
	const box = emitBox(spec);
	const origin = (draft?.id === active?.id ? draft?.origin : active?.origin) ??
		DEFAULT_ORIGIN;

	const presetMenu = (
		<MenuButton
			icon={<IconPlus />}
			items={Object.keys(EMIT_PRESETS).map(preset => ({
				label: t(`dialogs.slidersParticles.presets.${preset}`),
				onClick: () => void handleCreate(preset)
			}))}
			label={t('dialogs.slidersParticles.new')}
		/>
	);

	return (
		<DialogCard
			{...props}
			className="sliders-particles-dialog"
			headerLabel={t('dialogs.slidersParticles.title')}
			maximizable
		>
			<ButtonBar>
				{presetMenu}
				{active && (
					<>
						<IconButton
							icon={<IconPlayerPlay />}
							label={t('dialogs.slidersParticles.restart')}
							onClick={() => setRestart(n => n + 1)}
						/>
						<MenuButton
							icon={<IconWand />}
							items={Object.keys(EMIT_PRESETS).map(preset => ({
								label: t(`dialogs.slidersParticles.presets.${preset}`),
								onClick: () => edit({spec: {...EMIT_PRESETS[preset].params}})
							}))}
							label={t('dialogs.slidersParticles.applyPreset')}
						/>
						<ConfirmButton
							confirmVariant="danger"
							icon={<IconTrash />}
							label={t('common.delete')}
							onChangeOpen={setDeleteOpen}
							onConfirm={handleDelete}
							open={deleteOpen}
							prompt={t('dialogs.slidersParticles.deletePrompt', {
								name: active.name
							})}
						/>
					</>
				)}
			</ButtonBar>
			{error && (
				<CardContent>
					<p className="sliders-particles-error" role="alert">
						{error}
					</p>
				</CardContent>
			)}
			{emitters.length === 0 ? (
				<CardContent>
					<p>{t('dialogs.slidersParticles.none')}</p>
				</CardContent>
			) : (
				<div className="sliders-particles-body">
					<ul className="sliders-particles-list" role="listbox">
						{emitters.map(asset => (
							<li
								aria-selected={asset.id === active?.id}
								className={asset.id === active?.id ? 'selected' : undefined}
								key={asset.id}
								onClick={() => {
									void commit();
									setSelectedId(asset.id);
								}}
								role="option"
							>
								{urls[asset.id] && <img alt="" src={urls[asset.id]} />}
								<span>{asset.name}</span>
							</li>
						))}
					</ul>
					{active && (
						<>
							<div className="sliders-particles-stage">
								<ParticlePreview
									box={box}
									origin={origin}
									params={params}
									restart={restart}
									url={urls[active.id]}
								/>
								<p className="sliders-particles-hint">
									{t('dialogs.slidersParticles.hint', {name: active.name})}
								</p>
								<div className="sliders-particles-sprites">
									<span>{t('dialogs.slidersParticles.sprite')}</span>
									{sprites.map(sprite => (
										<button
											className={
												sprite.hash === active.hash ? 'selected' : undefined
											}
											key={sprite.id}
											onClick={() => void handleSprite(sprite)}
											title={sprite.name}
											type="button"
										>
											{urls[sprite.id] && <img alt={sprite.name} src={urls[sprite.id]} />}
										</button>
									))}
								</div>
							</div>
							<div className="sliders-particles-knobs">
								<EmitControls
									base={EMIT_DEFAULTS}
									onChange={patch => edit({spec: patch})}
									value={params}
								/>
								<AdjustSlider
									editable
									label={t('dialogs.slidersParticles.boxW')}
									max={1000}
									min={20}
									onChange={w => edit({spec: {box: {...box, w}}})}
									resetLabel={t('dialogs.slidersParticles.reset')}
									resetTo={DEFAULT_EMIT_BOX.w}
									step={10}
									value={box.w}
								/>
								<AdjustSlider
									editable
									label={t('dialogs.slidersParticles.boxH')}
									max={1000}
									min={20}
									onChange={h => edit({spec: {box: {...box, h}}})}
									resetLabel={t('dialogs.slidersParticles.reset')}
									resetTo={DEFAULT_EMIT_BOX.h}
									step={10}
									value={box.h}
								/>
								<AdjustSlider
									label={t('dialogs.slidersParticles.originX')}
									max={1}
									min={0}
									onChange={x => edit({origin: {...origin, x}})}
									resetLabel={t('dialogs.slidersParticles.reset')}
									resetTo={DEFAULT_ORIGIN.x}
									step={0.01}
									value={origin.x}
								/>
								<AdjustSlider
									label={t('dialogs.slidersParticles.originY')}
									max={1}
									min={0}
									onChange={y => edit({origin: {...origin, y}})}
									resetLabel={t('dialogs.slidersParticles.reset')}
									resetTo={DEFAULT_ORIGIN.y}
									step={0.01}
									value={origin.y}
								/>
							</div>
						</>
					)}
				</div>
			)}
		</DialogCard>
	);
};
