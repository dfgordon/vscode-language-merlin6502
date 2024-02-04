import * as vsserv from 'vscode-languageserver/node';
import * as vsdoc from 'vscode-languageserver-textdocument';
import * as diag from './diagnostics';
import * as comm from './commands';
import * as hov from './hovers';
import * as compl from './completions';
import * as tok from './semanticTokens';
import { AnalysisStack, MerlinContext } from './workspace';
import { LabelSentry, LabelNode, LabelSet } from './labels';
import * as lxbase from './langExtBase';
import * as Parser from 'web-tree-sitter';
import { defaultSettings } from './settings';
import * as path from 'path';

let globalSettings = defaultSettings;
let TSInitResult: [Parser, Parser.Language];
let diagnosticTool: diag.DiagnosticProvider;
let hoverTool: hov.HoverProvider;
let codeTool: compl.codeCompletionProvider;
let addressTool: compl.AddressCompletionProvider;
let disassembler: comm.DisassemblyTool;
let formatter: comm.FormattingTool;
let tokenizer: comm.Tokenizer;
let tokens: tok.TokenProvider;
let labels: LabelSentry;
let context: MerlinContext;
let diagnosticSet: diag.DiagnosticSet;

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = vsserv.createConnection(vsserv.ProposedFeatures.all);
const logger: lxbase.Logger = connection.console;

// Create a simple text document manager.
const windowDocs = new vsserv.TextDocuments(vsdoc.TextDocument);

async function startServer() {
	windowDocs.listen(connection);
	connection.listen();
	TSInitResult = await lxbase.TreeSitterInit();
	globalSettings = await connection.workspace.getConfiguration('merlin6502');
	diagnosticSet = new diag.DiagnosticSet;
	context = new MerlinContext(TSInitResult, logger, globalSettings);
	labels = new LabelSentry(context, diagnosticSet);
	diagnosticTool = new diag.DiagnosticProvider(labels);
	hoverTool = new hov.HoverProvider(TSInitResult, logger, globalSettings, labels);
	codeTool = new compl.codeCompletionProvider(TSInitResult, logger, globalSettings, labels);
	addressTool = new compl.AddressCompletionProvider(globalSettings);
	disassembler = new comm.DisassemblyTool(TSInitResult, logger, globalSettings);
	formatter = new comm.FormattingTool(TSInitResult, logger, globalSettings, labels);
	tokenizer = new comm.Tokenizer(TSInitResult, logger, globalSettings, labels);
	tokens = new tok.TokenProvider(TSInitResult, logger, globalSettings, labels);
	logger.log("finished constructing server objects");
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
				triggerCharacters: ['$', ':', ']', '(', '[', ',']
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
			logger.log('Workspace folder change event received, but not handled.');
		});
	}
});

connection.onDidChangeConfiguration(() => {
	connection.workspace.getConfiguration('merlin6502').then(settings => {
		globalSettings = settings;
		context.configure(globalSettings);
		hoverTool.configure(globalSettings);
		codeTool.configure(globalSettings);
		addressTool.configure(globalSettings);
		disassembler.configure(globalSettings);
		formatter.configure(globalSettings);
		tokenizer.configure(globalSettings);
		tokens.configure(globalSettings);
	}).then(() => {
		// emptying the stack will cause an update, because:
		// 1. client notifies server when active editor changes
		// 2. server checks to see if there is a re-usable context
		// 3. if no re-usable context (empty stack) force an update
		context.stack = new AnalysisStack;
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
	return tokens.provideDocumentRangeSemanticTokens(doc, params.range);
});

// Document symbol handling

function declarationsFromMap(map: Map<string, LabelNode[]>, params: vsserv.DefinitionParams): Array<vsserv.Location> | undefined {
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

function definitionsFromMap(map: Map<string, LabelNode[]>, params: vsserv.DefinitionParams): Array<vsserv.Location> | undefined {
	for (const vars of map.values()) {
		const ans = new Array<vsserv.Location>();
		let clicked = false;
		for (const node of vars) {
			//logger.log('checking ' + key + ',' + node.isDef + ',' + node.rng.start.line + ',' + node.doc.uri);
			clicked = clicked || lxbase.rangeContainsPos(node.rng, params.position) && node.doc.uri == params.textDocument.uri;
			if (node.isDef)
				ans.push(vsserv.Location.create(node.doc.uri, node.rng));
		}
		if (clicked)
			return ans;
	}
}

function referencesFromMap(map: Map<string, LabelNode[]>, params: vsserv.ReferenceParams): Array<vsserv.Location> | undefined {
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

function renamableFromMap(map: Map<string, LabelNode[]>, params: vsserv.RenameParams): string | undefined {
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
	return workspaceSymbolFromMap(context.entries, vsserv.SymbolKind.Constant);
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
	// macro locals are put in as children of macros
	return ans;
});

connection.onDeclaration(params => {
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!labelSet)
		return;
	for (const map of [labelSet.globals, labelSet.macros, labelSet.locals, labelSet.vars, labelSet.macro_locals]) {
		const ans = declarationsFromMap(map, params);
		if (ans)
			return ans;
	}
});

connection.onDefinition(params => {
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!labelSet)
		return;
	for (const map of [labelSet.globals, labelSet.macros, labelSet.locals, labelSet.vars, labelSet.macro_locals]) {
		const ans = definitionsFromMap(map, params);
		if (ans)
			return ans;
	}
});

connection.onReferences(params => {
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!labelSet)
		return;
	for (const map of [labelSet.globals, labelSet.macros, labelSet.locals, labelSet.vars, labelSet.macro_locals]) {
		const ans = referencesFromMap(map, params);
		if (ans)
			return ans;
	}
});

connection.onRenameRequest((params: vsserv.RenameParams): vsserv.WorkspaceEdit | undefined => {
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!labelSet)
		return;
	for (const map of [labelSet.globals, labelSet.macros, labelSet.locals, labelSet.vars, labelSet.macro_locals]) {
		const name = renamableFromMap(map, params);
		if (name) {
			const edits = new Array<vsserv.TextDocumentEdit>();
			const edmap = new Map<string, Array<vsserv.TextEdit>>();
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
	if (hoverTool) {
		return hoverTool.provideHover(windowDocs.get(params.textDocument.uri), params.position);
	}
});

connection.onCompletion((params: vsserv.CompletionParams): vsserv.CompletionItem[] => {
	let ans = new Array<vsserv.CompletionItem>();
	if (codeTool) {
		ans = ans.concat(codeTool.provideCompletionItems(windowDocs.get(params.textDocument.uri), params.position, params.context?.triggerCharacter));
	}
	if (addressTool && params.context?.triggerCharacter == '$') {
		ans = ans.concat(addressTool.provideCompletionItems(windowDocs.get(params.textDocument.uri), params.position));
	}
	return ans;
});

// Commands and Formatting

connection.onExecuteCommand(async (params: vsserv.ExecuteCommandParams): Promise<string | string[] | number[] | undefined> => {
	await waitForInit();
	let labelSet: LabelSet | undefined = undefined;
	if (["merlin6502.pasteFormat", "merlin6502.tokenize"].includes(params.command)) {
		if (params.arguments) {
			const lines: string[] = params.arguments[0];
			const uri: string = params.arguments[1];
			labelSet = labels.shared.get(uri);
			let tries = 0;
			while (!labelSet && tries < 20) {
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
			const disassemblyParams: comm.DisassemblyParams = params.arguments[1];
			const result = disassembler.disassemble(img, disassemblyParams);
			return result;
		}
	}
	else if (params.command == 'merlin6502.detokenize') {
		if (params.arguments)
			return tokenizer.detokenize(params.arguments);
	}
	else if (params.command == 'merlin6502.activeEditorChanged') {
		if (params.arguments) {
			//logger.log("looping to find " + params.arguments[0]);
			for (const doc of context.docs) {
				if (doc.uri == params.arguments[0]) {
					const master = context.get_master(doc);
					if (context.stack.doc.length == 0 || master.uri != context.stack.doc[0].uri) {
						logger.log("rescan and analyze " + doc.uri);
						context.rescan_entries = true;
						validateTextDocument(doc);
					}
					else {
						logger.log("reusing context " + master.uri);
						connection.sendNotification(new vsserv.NotificationType<string>('merlin6502.interpretation'), context.interpretation);
						const currMaster = path.basename(master.uri, ".S");
						connection.sendNotification(new vsserv.NotificationType<string>('merlin6502.context'), currMaster);
					}
				}
			}
		}
	}
	else if (params.command == 'merlin6502.rescan') {
		// unconditionally scan workspace
		logger.log("starting forced workspace scan");
		await getAllWorkspaceDocs();
		if (params.arguments) {
			//logger.log("looping to find " + params.arguments[0]);
			for (const doc of context.docs) {
				if (doc.uri == params.arguments[0]) {
					logger.log("analyzing " + doc.uri);
					validateTextDocument(doc);
				}
			}
		}
	}
	else if (params.command == 'merlin6502.getMasterList') {
		if (params.arguments) {
			const ans = new Array<string>();
			const includeKey = path.basename(params.arguments[0], ".S");
			const putSet = context.put_map.get(includeKey);
			if (putSet)
				for (const master of putSet)
					ans.push(master);
			const useSet = context.use_map.get(includeKey);
			if (useSet)
				for (const master of useSet)
					ans.push(master);
			if (ans.length == 0)
				return undefined;
			return ans;
		}
		return undefined;
	}
	else if (params.command == 'merlin6502.selectMaster') {
		if (params.arguments) {
			context.preferred_master = params.arguments[0];
			for (const doc of context.docs) {
				if (doc.uri == context.preferred_master) {
					logger.log('rescanning after master selection');
					await getAllWorkspaceDocs();
					validateTextDocument(doc);
				}
			}
		}
	}
});

connection.onDocumentRangeFormatting((params: vsserv.DocumentRangeFormattingParams): vsserv.TextEdit[] => {
	const doc = windowDocs.get(params.textDocument.uri);
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!doc || !labelSet)
		return [];
	return formatter.formatRange(doc.getText().split(/\r?\n/), params.range, labelSet.macros);
});

connection.onDocumentOnTypeFormatting((params: vsserv.DocumentOnTypeFormattingParams): vsserv.TextEdit[] => {
	const doc = windowDocs.get(params.textDocument.uri);
	const labelSet = labels.shared.get(params.textDocument.uri);
	if (!doc || !labelSet)
		return [];
	return formatter.formatTyping(doc.getText().split(/\r?\n/), params.position, params.ch, labelSet.macros);
});

// Document Analysis

async function waitForInit() {
	while (!diagnosticTool || !labels)
		await new Promise(resolve => setTimeout(resolve, 50));
}

async function getAllWorkspaceDocs() {
	const folders = await connection.workspace.getWorkspaceFolders();
	if (folders) {
		context.gather_docs(folders);
		context.updateWorkspaceDocs(windowDocs);
		context.scan_entries_and_includes();
		//logger.log("finished workspace scan");
	}
}

windowDocs.onDidOpen(async params => {
	await waitForInit();
	await getAllWorkspaceDocs();
	const doc = params.document;
	validateTextDocument(vsserv.TextDocumentItem.create(doc.uri, 'merlin6502', doc.version, doc.getText()));
});

windowDocs.onDidSave(async listener => {
	await waitForInit();
	await getAllWorkspaceDocs();
	const doc = listener.document;
	validateTextDocument(vsserv.TextDocumentItem.create(doc.uri, 'merlin6502', doc.version, doc.getText()));
});

windowDocs.onDidChangeContent(async change => {
	await waitForInit();
	if (!globalSettings.diagnostics.live)
		return;
	if (context.rescan_entries) {
		await getAllWorkspaceDocs();
	} else {
		context.updateWorkspaceDocs(windowDocs);
	}
	for (const doc of context.docs) {
		if (doc.uri == change.document.uri)
			validateTextDocument(doc);
	}
});

windowDocs.onDidClose(async params => {
	await waitForInit();
	if (labels.shared.has(params.document.uri))
		labels.shared.delete(params.document.uri);
	await getAllWorkspaceDocs();
});

async function validateTextDocument(textDocument: vsserv.TextDocumentItem): Promise<void> {
	await waitForInit();
	const diagnosticSet = diagnosticTool.update(textDocument);
	for (const uri of diagnosticSet.map.keys()) {
		labels.attach(uri);
	}
	connection.sendNotification(new vsserv.NotificationType<string>('merlin6502.interpretation'), context.interpretation);
	if (context.stack.doc.length > 0) {
		const currMaster = path.basename(context.stack.doc[0].uri, ".S");
		connection.sendNotification(new vsserv.NotificationType<string>('merlin6502.context'), currMaster);
	}
	for (const [uri, diagnostics] of diagnosticSet.map) {
		//logger.log("send diagnostics for " + uri);
		connection.sendDiagnostics({ uri, diagnostics });
	}
}

startServer();
