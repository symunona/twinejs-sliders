import * as React from 'react';
import {GlobalErrorBoundary} from './components/error';
import {HotkeysProvider} from './hotkeys';
import {LoadingCurtain} from './components/loading-curtain/loading-curtain';
import {LocaleSwitcher} from './store/locale-switcher';
import {PrefsContextProvider} from './store/prefs';
import {Routes} from './routes';
import {StoriesContextProvider} from './store/stories';
import {StoryFormatsContextProvider} from './store/story-formats';
import {ServerSyncProvider} from './store/persistence/server';
import {LibraryProvider} from './store/asset-library/library-provider';
import {LibraryToasts} from './dialogs/sliders-assets/library/library-toasts';
import {StateLoader} from './store/state-loader';
import {ThemeSetter} from './store/theme-setter';
import './styles/typography.css';

export const App: React.FC = () => (
	<GlobalErrorBoundary>
		<PrefsContextProvider>
			<LocaleSwitcher />
			<ThemeSetter />
			<StoryFormatsContextProvider>
				<StoriesContextProvider>
					<StateLoader>
						{/* Alongside the local persistence layer, never inside it: a
						    failing network must not be able to break local saving. */}
						<ServerSyncProvider>
							{/* The shared asset library's engine: one per session. */}
							<LibraryProvider>
								<HotkeysProvider>
									<React.Suspense fallback={<LoadingCurtain />}>
										<Routes />
										{/* Inside Suspense: useTranslation suspends until the locale loads. */}
										<LibraryToasts />
									</React.Suspense>
								</HotkeysProvider>
							</LibraryProvider>
						</ServerSyncProvider>
					</StateLoader>
				</StoriesContextProvider>
			</StoryFormatsContextProvider>
		</PrefsContextProvider>
	</GlobalErrorBoundary>
);
