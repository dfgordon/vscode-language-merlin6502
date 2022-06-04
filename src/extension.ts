import * as vscode from 'vscode';
import * as lxbase from './langExtBase';
import { TSHoverProvider } from './hovers';
import { TSDiagnosticProvider } from './diagnostics';
import { DocTokensProvider, legend, RangeTokensProvider } from './semanticTokens';
import { LabelSentry, LabelSet } from './labels'
import * as completions from './completions';
import * as com from './commands';

export let sharedLabels = new LabelSet();

/// This function runs when the extension loads.
/// It creates the parser object, sets up the providers, and sets up event callbacks.
export function activate(context: vscode.ExtensionContext)
{
	lxbase.TreeSitterInit().then( TSInitResult =>
	{
		const selector = { language: 'merlin6502' };
		const collection = vscode.languages.createDiagnosticCollection('merlin6502-file');
		const labelSentry = new LabelSentry(TSInitResult);
		const diagnostics = new TSDiagnosticProvider(TSInitResult,labelSentry);
		const rngTokens = new RangeTokensProvider(TSInitResult);
		const docTokens = new DocTokensProvider(TSInitResult);
		const hovers = new TSHoverProvider(TSInitResult);
		const snippetCompletions = new completions.TSCompletionProvider(TSInitResult);
		const addressCompletions = new completions.AddressCompletionProvider();
		const disassembler = new com.DisassemblyTool(TSInitResult);

		const versionIndicator = vscode.window.createStatusBarItem();
		const typeIndicator = vscode.window.createStatusBarItem();
		versionIndicator.text = vscode.workspace.getConfiguration('merlin6502').get('version') as string;
		versionIndicator.tooltip = 'Merlin version begin targeted (see settings)';
		typeIndicator.text = 'source';
		typeIndicator.tooltip = 'How the file is interpreted, as source or linker commands'

		const startEditor = vscode.window.activeTextEditor;
		if (startEditor?.document.languageId=='merlin6502')
		{
			lxbase.LoadSources(startEditor.document).then(docs => {
				if (startEditor)
				{
					labelSentry.prepare_externals(docs).then( () => {
						labelSentry.GetProperties(startEditor.document);
						labelSentry.scan_entries(startEditor.document);
						diagnostics.update(startEditor.document,collection,versionIndicator,typeIndicator,true);
					}).catch(reason => {
						vscode.window.showErrorMessage('Could not analyze project sources:\n'+reason);
					});
				}
			}).catch(reason => {
				vscode.window.showErrorMessage('Could not find project sources:\n'+reason);
			});
		}
		let rngTokDisposable = vscode.languages.registerDocumentRangeSemanticTokensProvider(selector,rngTokens,legend);
		let docTokDisposable = vscode.languages.registerDocumentSemanticTokensProvider(selector,docTokens,legend);
		vscode.languages.registerHoverProvider(selector,hovers);
		vscode.languages.registerCompletionItemProvider(selector,snippetCompletions,':',']',' ');
		vscode.languages.registerCompletionItemProvider(selector,addressCompletions,'$');
		vscode.languages.registerDeclarationProvider(selector,labelSentry);
		let docSymDisposable = vscode.languages.registerDocumentSymbolProvider(selector,labelSentry);

		context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getFrontVii",disassembler.getFrontVirtualII,disassembler));
		context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getAppleWinSaveState",disassembler.getAppleWinSaveState,disassembler));
		context.subscriptions.push(vscode.commands.registerCommand("merlin6502.format",disassembler.showPasteableProgram,disassembler));
		context.subscriptions.push(vscode.commands.registerCommand("merlin6502.columns",disassembler.resizeColumns,disassembler));
		context.subscriptions.push(collection);

		context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(listener => {
			if (listener)
			{
				sharedLabels = diagnostics.labelSentry.labels;
				// docSymDisposable.dispose();
				// docSymDisposable = vscode.languages.registerDocumentSymbolProvider(selector,labelSentry);
			}
		}));
		context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor?.document.languageId=='merlin6502')
			{
				docSymDisposable.dispose();
				lxbase.LoadSources(editor.document).then(docs => {
					if (editor)
					{
						labelSentry.prepare_externals(docs).then( () => {
							labelSentry.GetProperties(editor.document);
							labelSentry.scan_entries(editor.document);
							diagnostics.update(editor.document,collection,versionIndicator,typeIndicator,true);
							docSymDisposable = vscode.languages.registerDocumentSymbolProvider(selector,labelSentry);
						}).catch(reason => {
							vscode.window.showErrorMessage('Could not analyze project sources:\n'+reason)
						});
					}
				}).catch(reason => {
					vscode.window.showErrorMessage('Could not find project sources:\n'+reason);
				});
			}
			else
			{
				versionIndicator.hide();
				typeIndicator.hide();
			}
		}));
		context.subscriptions.push(vscode.workspace.onWillSaveTextDocument(listener => {
			if (listener && listener.document.languageId=='merlin6502')
				diagnostics.update(listener.document,collection,versionIndicator,typeIndicator,true);
		}));
		context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(listener => {
			if (listener && listener.document.languageId=='merlin6502')
			{
				let entered = false;
				for (const change of listener.contentChanges)
					entered = entered || change.text.includes('\n');
				diagnostics.update(listener.document,collection,versionIndicator,typeIndicator,entered);
			}
		}));
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(listener => {
			if (listener)
			{
				addressCompletions.rebuild();
				versionIndicator.text = vscode.workspace.getConfiguration('merlin6502').get('version') as string;
				rngTokDisposable.dispose();
				docTokDisposable.dispose();
				rngTokDisposable = vscode.languages.registerDocumentRangeSemanticTokensProvider(selector,rngTokens,legend);
				docTokDisposable = vscode.languages.registerDocumentSemanticTokensProvider(selector,docTokens,legend);
			}
		}));
	});
}
