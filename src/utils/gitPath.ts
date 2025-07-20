import { workspace } from 'vscode';


export default function gitPath(): string {
	return workspace.getConfiguration('git').get('path', 'git') ?? 'git';
}