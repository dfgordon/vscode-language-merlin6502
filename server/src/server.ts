import * as vsserv from 'vscode-languageserver/node';
import * as vsdoc from 'vscode-languageserver-textdocument';
import * as diag from './diagnostics';
import * as comm from './commands';
import * as hov from './hovers';
import * as compl from './completions';
import * as tok from './semanticTokens';
import {LabelSentry, LabelNode, LabelSet} from './labels';
import * as lxbase from './langExtBase';
import * as Parser from 'web-tree-sitter';
import { defaultSettings } from './settings';
import * as vsuri from 'vscode-uri';
import * as fs from 'fs';
import { glob } from 'glob';

let globalSettings = defaultSettings;
let TSInitResult: [Parser, Parser.Language];
let diagnosticTool: diag.TSDiagnosticProvider;
let hoverTool: hov.TSHoverProvider;
let codeTool: compl.codeCompletionProvider;
let addressTool: compl.AddressCompletionProvider;
let disassembler: comm.DisassemblyTool;
let formatter: comm.FormattingTool;
let tokenizer: comm.Tokenizer;
let tokens: tok.TokenProvider;
let labels: LabelSentry;

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = vsserv.createConnection(vsserv.ProposedFeatures.all);

// Create a simple text document manager.
const windowDocs = new vsserv.TextDocuments(vsdoc.TextDocument);
let workspaceDocs = new Array<vsserv.TextDocumentItem>();

async function startServer()
{
	windowDocs.listen(connection);
	connection.listen();
	TSInitResult = await lxbase.TreeSitterInit();
	globalSettings = await connection.workspace.getConfiguration('merlin6502');
	labels = new LabelSentry(TSInitResult, globalSettings); // create labels first
	diagnosticTool = new diag.TSDiagnosticProvider(TSInitResult, globalSettings, labels);
	hoverTool = new hov.TSHoverProvider(TSInitResult, globalSettings, labels);
	codeTool = new compl.codeCompletionProvider(TSInitResult, globalSettings, labels);
	addressTool = new compl.AddressCompletionProvider(globalSettings);
	disassembler = new comm.DisassemblyTool(TSInitResult, globalSettings);
	formatter = new comm.FormattingTool(TSInitResult, globalSettings, labels);
	tokenizer = new comm.Tokenizer(TSInitResult, globalSettings, labels);
	tokens = new tok.TokenProvider(TSInitResult, globalSettings, labels);
}

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
// let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: vsserv.InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	// hasDiagnosticRelatedInformationCapability = !!(
	// 	capabilities.textDocument &&
	// 	capabilities.textDocument.publishDiagnostics &&
	// 	capabilities.textDocument.publishDiagnostics.relatedInformation
	// );

	const result: vsserv.InitializeResult = {
		capabilities: {
			textDocumentSync: vsserv.TextDocumentSyncKind.Full,
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: ['$',':',']','(','[',',']
			},
			semanticTokensProvider: { range: true, full: true, documentSelector: ['merlin6502'], legend: tok.legend },
			declarationProvider: true,
			definitionProvider: true,
			referencesProvider: true,
			hoverProvider: true,
			workspaceSymbolProvider: true,
			documentSymbolProvider: true,
			renameProvider: true,
			documentRangeFormattingProvider: true,
			documentOnTypeFormattingProvider: { firstTriggerCharacter: ' ', moreTriggerCharacter: [';'] }
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(vsserv.DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(() => {
			connection.console.log('Workspace folder change event received, but not handled.');
		});
	}
});

connection.onDidChangeConfiguration(() => {
	connection.workspace.getConfiguration('merlin6502').then(settings => {
		globalSettings = settings;
		diagnosticTool.configure(globalSettings);
		hoverTool.configure(globalSettings);
		codeTool.configure(globalSettings);
		addressTool.configure(globalSettings);
		disassembler.configure(globalSettings);
		formatter.configure(globalSettings);
		tokenizer.configure(globalSettings);
		tokens.configure(globalSettings);
		labels.configure(globalSettings);
	}).then(() => {
		windowDocs.all().forEach(doc => {
			validateTextDocument(doc);
		});
	});
});

// Provide for semantic highlights

connection.onRequest(vsserv.SemanticTokensRequest.type, (params: vsserv.SemanticTokensParams): vsserv.SemanticTokens | null => {
	const doc = windowDocs.get(params.textDocument.uri);
	if (!doc)
		return null;
	return tokens.provideDocumentSemanticTokens(doc);
});

connection.onRequest(vsserv.SemanticTokensRangeRequest.type, (params: vsserv.SemanticTokensRangeParams): vsserv.SemanticTokens | null => {
	const doc = windowDocs.get(params.textDocument.uri);
	if (!doc)
		return null;
	return tokens.provideDocumentRangeSemanticTokens(doc,params.range);
});

// Document symbol handling

function declarationsFromMap(map: Map<string,LabelNode[]>, params: vsserv.DefinitionParams): Array<vsserv.Location> | undefined {
	for (const vars of map.values()) {
		const ans = new Array<vsserv.Location>();
		let clicked = false;
		for (const node of vars) {
			clicked = clicked || lxbase.rangeContainsPos(node.rng, params.position) && node.doc.uri == params.textDocument.uri;
			if (node.isDec)
				ans.push(vsserv.Location.create(node.doc.uri, node.rng));
		}
		if (clicked)
			return ans;
	}
}

function definitionsFromMap(map: Map<string,LabelNode[]>, params: vsserv.DefinitionParams): Array<vsserv.Location> | undefined {
	for (const vars of map.values()) {
		const ans = new Array<vsserv.Location>();
		let clicked = false;
		for (const node of vars) {
			clicked = clicked || lxbase.rangeContainsPos(node.rng, params.position) && node.doc.uri == params.textDocument.uri;
			if (node.isDef)
				ans.push(vsserv.Location.create(node.doc.uri, node.rng));
		}
		if (clicked)
			return ans;
	}
}

function referencesFromMap(map: Map<string,LabelNode[]>, params: vsserv.ReferenceParams): Array<vsserv.Location> | undefined {
	for (const vars of map.values()) {
		const ans = new Array<vsserv.Location>();
		let clicked = false;
		for (const node of vars) {
			clicked = clicked || lxbase.rangeContainsPos(node.rng, params.position) && node.doc.uri == params.textDocument.uri;
			if (node.isRef)
				ans.push(vsserv.Location.create(node.doc.uri, node.rng));
		}
		if (clicked)
			return ans;
	}
}

function renamableFromMap(map: Map<string,LabelNode[]>, params: vsserv.RenameParams): string | undefined {
	for (const [name, vars] of map) {
		let clicked = false;
		for (const node of vars) {
			clicked = clicked || lxbase.rangeContainsPos(node.rng, params.position) && node.doc.uri == params.textDocument.uri;
		}
		if (clicked)
			return name;
	}
}

function workspaceSymbolFromMap(map: Map<string, LabelNode[]>, kind: vsserv.SymbolKind): Array<vsserv.WorkspaceSymbol> {
	const ans = new Array<vsserv.WorkspaceSymbol>();
	for (const [name, vars] of map) {
		for (const node of vars)
			ans.push(vsserv.WorkspaceSymbol.create(name, kind, node.doc.uri, node.rng));
	}
	return ans;
}

function documentSymbolFromMap(map: Map<string, LabelNode[]>, kind: vsserv.SymbolKind, uri: string): Array<vsserv.DocumentSymbol> {
	const ans = new Array<vsserv.DocumentSymbol>();
	for (const [name, vars] of map) {
		for (const node of vars) {
			if (node.doc.uri == uri && !node.isRef) {
				const children = new Array<vsserv.DocumentSymbol>();
				let detail = undefined;
				if (node.isEntry)
					detail = 'entry';
				if (node.isExternal)
					detail = 'external';
				for (const child of node.children) {
					children.push(vsserv.DocumentSymbol.create(child.name, 'local', vsserv.SymbolKind.Constant, child.loc.range, child.loc.range));
				}
				if (node.isSub)
					ans.push(vsserv.DocumentSymbol.create(name, detail, vsserv.SymbolKind.Function, node.rng, node.rng, children));
				else
					ans.push(vsserv.DocumentSymbol.create(name, detail, kind, node.rng, node.rng, children));
			}
		}
	}
	return ans;
}

connection.onWorkspaceSymbol(() => {
	return workspaceSymbolFromMap(labels.entries, vsserv.SymbolKind.Constant);
});

connection.onDocumentSymbol(async params => {
	await waitForInit();
	const uri = params.textDocument.uri;
	let ans = new Array<vsserv.DocumentSymbol>();
	const labelSet = labels.shared.get(uri);
	if (!labelSet)
		return ans;
	ans = ans.concat(documentSymbolFromMap(labelSet.globals, vsserv.SymbolKind.Constant, uri));
	ans = ans.concat(documentSymbolFromMap(labelSet.macros, vsserv.SymbolKind.Function, uri));
	ans = ans.concat(documentSymbolFromMap(labelSet.vars, vsserv.SymbolKind.Variable, uri));
	// local labels are put in as children of globals
	return ans;
});

connection.onDeclaration(params => {
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!labelSet)
		return;
	for (const map of [labelSet.globals, labelSet.macros, labelSet.locals, labelSet.vars]) {
		const ans = declarationsFromMap(map, params);
		if (ans)
			return ans;
	}
});

connection.onDefinition(params => {
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!labelSet)
		return;
	for (const map of [labelSet.globals, labelSet.macros, labelSet.locals, labelSet.vars]) {
		const ans = definitionsFromMap(map, params);
		if (ans)
			return ans;
	}
});

connection.onReferences(params => {
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!labelSet)
		return;
	for (const map of [labelSet.globals, labelSet.macros, labelSet.locals, labelSet.vars]) {
		const ans = referencesFromMap(map, params);
		if (ans)
			return ans;
	}
});

connection.onRenameRequest((params: vsserv.RenameParams): vsserv.WorkspaceEdit | undefined => {
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!labelSet)
		return;
	for (const map of [labelSet.globals, labelSet.macros, labelSet.locals, labelSet.vars]) {
		const name = renamableFromMap(map, params);
		if (name) {
			const edits = new Array<vsserv.TextDocumentEdit>();
			const edmap = new Map<string,Array<vsserv.TextEdit>>();
			const lnodes = map.get(name);
			if (lnodes) {
				for (const node of lnodes) {
					const ed = vsserv.TextEdit.replace(node.rng, params.newName);
					if (edmap.has(node.doc.uri))
						edmap.get(node.doc.uri)?.push(ed);
					else
						edmap.set(node.doc.uri, [ed]);
				}
			}
			for (const [uri, eds] of edmap) {
				const id = vsserv.VersionedTextDocumentIdentifier.create(uri, 0);
				edits.push(vsserv.TextDocumentEdit.create(id, eds));
			}
			return { documentChanges: edits };
		}
	}
});

// Hovers and Completions

connection.onHover(params => {
	if (hoverTool)
	{
		return hoverTool.provideHover(windowDocs.get(params.textDocument.uri), params.position);
	}
});

connection.onCompletion((params: vsserv.CompletionParams): vsserv.CompletionItem[] => {
	let ans = new Array<vsserv.CompletionItem>();
	if (codeTool)
	{
		ans = ans.concat(codeTool.provideCompletionItems(windowDocs.get(params.textDocument.uri), params.position, params.context?.triggerCharacter));	
	}
	if (addressTool && params.context?.triggerCharacter=='$')
	{
		ans = ans.concat(addressTool.provideCompletionItems(windowDocs.get(params.textDocument.uri), params.position));	
	}
	return ans;
});

// Commands and Formatting

connection.onExecuteCommand(async (params: vsserv.ExecuteCommandParams): Promise<any> => {
	await waitForInit();
	let labelSet: LabelSet | undefined = undefined;
	if (["merlin6502.pasteFormat", "merlin6502.tokenize"].includes(params.command)) {
		if (params.arguments) {
			const lines : string[] = params.arguments[0];
			const uri: string = params.arguments[1];
			labelSet = labels.shared.get(uri);
			let tries = 0;
			while (!labelSet && tries<20) {
				await new Promise(resolve => setTimeout(resolve, 50));
				labelSet = labels.shared.get(uri);
				tries += 1;
			}
			if (!labelSet)
				return '* could not find document symbols';
			if (params.command == 'merlin6502.pasteFormat')
				return formatter.formatForPaste(lines, labelSet.macros);
			else if (params.command == 'merlin6502.tokenize')
				return tokenizer.tokenize(lines, labelSet.macros);
		}		
	}
	else if (params.command == 'merlin6502.disassemble') {
		if (params.arguments) {
			const img: number[] = params.arguments[0];
			const disassemblyParams : comm.DisassemblyParams = params.arguments[1];
			const result = disassembler.disassemble(img, disassemblyParams);
			return result;
		}
	}
	else if (params.command == 'merlin6502.detokenize') {
		if (params.arguments)
			return tokenizer.detokenize(params.arguments);
	}
});

connection.onDocumentRangeFormatting((params: vsserv.DocumentRangeFormattingParams): vsserv.TextEdit[] => {
	const doc = windowDocs.get(params.textDocument.uri);
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!doc || !labelSet)
		return [];
	return formatter.formatRange(doc.getText().split('\n'), params.range, labelSet.macros);
});

connection.onDocumentOnTypeFormatting((params: vsserv.DocumentOnTypeFormattingParams): vsserv.TextEdit[] => {
	const doc = windowDocs.get(params.textDocument.uri);
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!doc || !labelSet)
		return [];
	return formatter.formatTyping(doc.getText().split('\n'), params.position, params.ch, labelSet.macros);
});

// Document Analysis

async function waitForInit() {
	while (!diagnosticTool || !labels)
		await new Promise(resolve => setTimeout(resolve, 50));
}

async function getAllWorkspaceDocs() {
	const folders = await connection.workspace.getWorkspaceFolders();
	if (folders) {
		workspaceDocs = new Array<vsserv.TextDocumentItem>();
		for (const folder of folders) {
			const folderUri = vsuri.URI.parse(folder.uri);
			const globUri = vsuri.Utils.joinPath(folderUri, '**', '*.S');
			const files = glob.sync(globUri.fsPath);
			files.forEach(f => {
				const fileUri = vsuri.URI.file(f);
				const content: string = fs.readFileSync(f, { encoding: "utf8" });
				workspaceDocs.push(vsserv.TextDocumentItem.create(fileUri.toString(), 'merlin6502', 0, content));
			});
		}
		labels.workspaceFolders = folders;
		updateWorkspaceDocs();
		labels.scan_entries(workspaceDocs);
	}
}

function updateWorkspaceDocs() {
	// this should be an inexpensive set of pointer updates
	for (const doc of workspaceDocs) {
		const winDoc = windowDocs.get(doc.uri);
		if (winDoc) {
			doc.text = winDoc.getText();
			doc.version = winDoc.version;
		}
	}
}

windowDocs.onDidOpen(async params => {
	await waitForInit();
	await getAllWorkspaceDocs();
	validateTextDocument(params.document);
});

windowDocs.onDidSave(async listener => {
	await waitForInit();
	await getAllWorkspaceDocs();
	validateTextDocument(listener.document);
});

windowDocs.onDidChangeContent(async change => {
	await waitForInit();
	if (labels.rescan_entries) {
		await getAllWorkspaceDocs();
	} else {
		updateWorkspaceDocs();
	}
	for (const doc of windowDocs.all()) {
		const included = labels.shared.get(doc.uri)?.includedDocs.has(change.document.uri);
		if (doc.uri == change.document.uri || included)
			validateTextDocument(doc);
	}
});

windowDocs.onDidClose(async params => {
	await waitForInit();
	if (labels.shared.has(params.document.uri))
		labels.shared.delete(params.document.uri);
	await getAllWorkspaceDocs();
});

async function validateTextDocument(textDocument: vsdoc.TextDocument): Promise<void> {
	await waitForInit();
	const diagnostics = diagnosticTool.update(textDocument);
	connection.sendNotification(new vsserv.NotificationType<string>('merlin6502.interpretation'), diagnosticTool.interpretation);
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

startServer();
