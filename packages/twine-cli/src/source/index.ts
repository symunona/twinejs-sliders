/**
 * Which side answers a read (spec 12 §0).
 *
 * Local is an optimisation, not a second personality: both implementations answer the same
 * questions with the same shapes, so a command never learns which one it got. The rule is
 * one line — if DATA_DIR is here and readable, read it.
 */

import {usableDataDir} from '../config';
import type {Config, Source} from '../types';
import {Http, HttpSource} from './http';
import {LocalSource} from './local';

export {Http, HttpError, HttpSource, apiBase, errorFor, exitForStatus} from './http';
export {LocalSource} from './local';

export function makeSource(config: Config): Source {
	if (usableDataDir(config.dataDir)) {
		return new LocalSource(config.dataDir);
	}

	return new HttpSource(
		new Http({
			clientId: config.clientId,
			clientName: config.clientName,
			server: config.server,
			token: config.token
		})
	);
}
