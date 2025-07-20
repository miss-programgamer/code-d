import { default as axios, ResponseType, AxiosInstance } from 'axios';

import extension from '../extension.js';
import httpProxy from './httpProxy.js';


export function reqType(type: ResponseType, baseURL?: string | undefined, timeout: number = 10_000): AxiosInstance {
	const proxy = httpProxy();

	if (proxy != null) {
		process.env['http_proxy'] = proxy;
	}

	return axios.create({
		baseURL,
		responseType: type,
		timeout: timeout,
		headers: {
			'User-Agent': `code-d/${extension.version} (github:Pure-D/code-d)`,
		}
	});
}

export function reqJson(baseURL?: string | undefined, timeout: number = 10_000): AxiosInstance {
	return reqType('json', baseURL, timeout);
}

export function reqText(baseURL?: string | undefined, timeout: number = 10_000): AxiosInstance {
	return reqType('text', baseURL, timeout);
}