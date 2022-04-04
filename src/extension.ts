import * as vscode from 'vscode';
import * as lxbase from './langExtBase';
import { TSHoverProvider } from './hovers';
import { TSDiagnosticProvider } from './diagnostics';
import { TSSemanticTokensProvider, legend } from './semanticTokens';
import * as completions from './completions';
import * as com from './commands';

/// This function runs when the extension loads.
/// It creates the parser object and sets up the providers.
export function activate(context: vscode.ExtensionContext)
{
	lxbase.TreeSitterInit().then( TSInitResult =>
	{
		const selector = { language: 'merlin6502' };
		const collection = vscode.languages.createDiagnosticCollection('merlin6502-file');
		const diagnostics = new TSDiagnosticProvider(TSInitResult);
		const tokens = new TSSemanticTokensProvider(TSInitResult);
		const hovers = new TSHoverProvider(TSInitResult);
		const snippetCompletions = new completions.TSCompletionProvider();
		const addressCompletions = new completions.AddressCompletionProvider();
		const disassembler = new com.DisassemblyTool(TSInitResult);
		if (vscode.window.activeTextEditor)
		{
			diagnostics.update(vscode.window.activeTextEditor.document, collection);
		}
		vscode.languages.registerDocumentSemanticTokensProvider(selector,tokens,legend);
		vscode.languages.registerHoverProvider(selector,hovers);
		vscode.languages.registerCompletionItemProvider(selector,snippetCompletions);
		vscode.languages.registerCompletionItemProvider(selector,addressCompletions,'$');

		//context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getFrontVii",disassembler.getFrontVirtualII,disassembler));
		//context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getAppleWinSaveState",disassembler.getAppleWinSaveState,disassembler));
		context.subscriptions.push(vscode.commands.registerCommand("merlin6502.format",disassembler.showPasteableProgram,disassembler));

		context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor)
				diagnostics.update(editor.document, collection);
		}));
		context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(editor => {
			if (editor)
				diagnostics.update(editor.document, collection);
		}));
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(listener => {
			if (listener)
				addressCompletions.rebuild();
		}));
	});
}
