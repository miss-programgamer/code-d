import { Location, getLocation, createScanner, SyntaxKind } from 'jsonc-parser';
import { DubJSONContribution } from './dub/json.js';
import { CancellationToken, CompletionItem, CompletionItemProvider, CompletionList, Disposable, DocumentSelector, Hover, HoverProvider, languages, MarkdownString, Position, Range, TextDocument } from 'vscode';

export interface ISuggestionsCollector {
	add(suggestion: CompletionItem): void;
	error(message: string): void;
	log(message: string): void;
}

export interface IJSONContribution {
	getDocumentSelector(): DocumentSelector;
	getInfoContribution(fileName: string, location: Location): Thenable<MarkdownString[]>;
	collectPropertySuggestions(fileName: string, location: Location, currentWord: string, addValue: boolean, isLast: boolean, result: ISuggestionsCollector): Thenable<void>;
	collectValueSuggestions(fileName: string, location: Location, result: ISuggestionsCollector): Thenable<void>;
	resolveSuggestion?(item: CompletionItem): Thenable<CompletionItem>;
}

/**
 * Register completion and hover providers for JSON settings files.
 */
export function addJSONProviders(): Disposable {
	const subs: Disposable[] = [];

	const contributions: IJSONContribution[] = [
		new DubJSONContribution(),
	];

	for (const contribution of contributions) {
		const provider = new JSONProvider(contribution);
		const selector = contribution.getDocumentSelector();
		subs.push(languages.registerCompletionItemProvider(selector, provider, '"', ':', '/', '\\'));
		subs.push(languages.registerHoverProvider(selector, provider));
	}

	return Disposable.from(...subs);
}

export class JSONProvider implements HoverProvider, CompletionItemProvider {
	constructor(private jsonContribution: IJSONContribution) { }

	public provideHover(document: TextDocument, position: Position, token: CancellationToken): Thenable<Hover> | null {
		let offset = document.offsetAt(position);
		let location = getLocation(document.getText(), offset);
		let node = location.previousNode;
		if (node && node.offset <= offset && offset <= node.offset + node.length) {
			let promise = this.jsonContribution.getInfoContribution(document.fileName, location);
			if (promise) {
				return promise.then(htmlContent => {
					let range = new Range(document.positionAt((<any>node).offset), document.positionAt((<any>node).offset + (<any>node).length));
					let result: Hover = {
						contents: htmlContent,
						range: range
					};
					return result;
				});
			}
		}
		return null;
	}

	public resolveCompletionItem(item: CompletionItem, token: CancellationToken): Thenable<CompletionItem> {
		if (this.jsonContribution.resolveSuggestion) {
			let resolver = this.jsonContribution.resolveSuggestion(item);
			if (resolver) {
				return resolver;
			}
		}
		return Promise.resolve(item);
	}

	public provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken): Thenable<CompletionList | null> | null {
		let currentWord = this.getCurrentWord(document, position);
		let overwriteRange: Range | null = null;
		let items: CompletionItem[] = [];

		let offset = document.offsetAt(position);
		let location = getLocation(document.getText(), offset);

		let node = location.previousNode;
		if (node && node.offset <= offset && offset <= node.offset + node.length && (node.type === 'property' || node.type === 'string' || node.type === 'number' || node.type === 'boolean' || node.type === 'null')) {
			overwriteRange = new Range(document.positionAt(node.offset), document.positionAt(node.offset + node.length));
		} else {
			overwriteRange = new Range(document.positionAt(offset - currentWord.length), position);
		}

		let proposed: { [key: string]: boolean; } = {};
		let collector: ISuggestionsCollector = {
			add: (suggestion: CompletionItem) => {
				if (!proposed[typeof suggestion.label === 'string' ? suggestion.label : suggestion.label.label]) {
					proposed[typeof suggestion.label === 'string' ? suggestion.label : suggestion.label.label] = true;
					if (overwriteRange) {
						suggestion.range = overwriteRange;
					}

					items.push(suggestion);
				}
			},
			error: (message: string) => console.error(message),
			log: (message: string) => console.log(message)
		};

		let collectPromise: Thenable<any> | null = null;

		if (location.isAtPropertyKey) {
			let addValue = !location.previousNode
				|| (!location.previousNode.colonOffset && (offset === (location.previousNode.offset + location.previousNode.length)))
				|| (location.isAtPropertyKey && !location.previousNode?.colonOffset);
			let scanner = createScanner(document.getText(), true);
			scanner.setPosition(offset);
			scanner.scan();
			let isLast = scanner.getToken() === SyntaxKind.CloseBraceToken || scanner.getToken() === SyntaxKind.EOF;
			collectPromise = this.jsonContribution.collectPropertySuggestions(document.fileName, location, currentWord, addValue, isLast, collector);
		} else if (location.path.length !== 0)
			collectPromise = this.jsonContribution.collectValueSuggestions(document.fileName, location, collector);

		if (collectPromise) {
			return collectPromise.then(() => {
				if (items.length > 0)
					return new CompletionList(items);
				else
					return null;
			});
		}
		return null;
	}

	private getCurrentWord(document: TextDocument, position: Position) {
		let i = position.character - 1;
		const text = document.lineAt(position.line).text;

		while (i >= 0 && ' \t\n\r\v"{[,'.indexOf(text.charAt(i)) === -1) {
			i--;
		}

		return text.substring(i + 1, position.character);
	}
}