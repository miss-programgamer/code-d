import { workspace } from 'vscode';


export default function httpProxy(): string | undefined {
	return workspace.getConfiguration('http').get('proxy', undefined);
}