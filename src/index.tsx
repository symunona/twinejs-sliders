import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {App} from './app';
import {registerServiceWorker} from './util/service-worker';
import './util/i18n';

registerServiceWorker();

ReactDOM.render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
	document.getElementById('root')
);
