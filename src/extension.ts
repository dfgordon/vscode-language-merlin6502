import * as vscode from 'vscode';
import * as lxbase from './langExtBase';
import { TSHoverProvider } from './hovers';
import { TSDiagnosticProvider } from './diagnostics';
import { TSSemanticTokensProvider, legend } from './semanticTokens';
import { LabelSentry } from './labels'
import * as completions from './completions';
import * as com from './commands';

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
		const tokens = new TSSemanticTokensProvider(TSInitResult,labelSentry);
		const hovers = new TSHoverProvider(TSInitResult,labelSentry);
		const snippetCompletions = new completions.TSCompletionProvider(TSInitResult,labelSentry);
		const addressCompletions = new completions.AddressCompletionProvider();
		const disassembler = new com.DisassemblyTool(TSInitResult,labelSentry);

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
						labelSentry.scan_entries();
						diagnostics.update(startEditor.document, collection);
						typeIndicator.text = diagnostics.get_interpretation(startEditor.document);
						versionIndicator.show();
						typeIndicator.show();
					});
				}
			}).catch(reason => {
				vscode.window.showErrorMessage('Could not analyze project sources');
			});
		}
		vscode.languages.registerDocumentSemanticTokensProvider(selector,tokens,legend);
		vscode.languages.registerHoverProvider(selector,hovers);
		vscode.languages.registerCompletionItemProvider(selector,snippetCompletions,':',']',' ');
		vscode.languages.registerCompletionItemProvider(selector,addressCompletions,'$');

		context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getFrontVii",disassembler.getFrontVirtualII,disassembler));
		context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getAppleWinSaveState",disassembler.getAppleWinSaveState,disassembler));
		context.subscriptions.push(vscode.commands.registerCommand("merlin6502.format",disassembler.showPasteableProgram,disassembler));
		context.subscriptions.push(vscode.commands.registerCommand("merlin6502.columns",disassembler.resizeColumns,disassembler));

		context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor?.document.languageId=='merlin6502')
			{
				lxbase.LoadSources(editor.document).then(docs => {
					if (editor)
					{
						labelSentry.prepare_externals(docs).then( () => {
							labelSentry.GetProperties(editor.document);
							labelSentry.scan_entries();
							diagnostics.update(editor.document, collection);
							typeIndicator.text = diagnostics.get_interpretation(editor.document);
							versionIndicator.show();
							typeIndicator.show();
						});
					}
				}).catch(reason => {
					vscode.window.showErrorMessage('Could not analyze project sources');
				});
			}
			else
			{
				versionIndicator.hide();
				typeIndicator.hide();
			}
		}));
		context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(editor => {
			if (editor && editor.document.languageId=='merlin6502')
			{
				diagnostics.update(editor.document, collection);
				typeIndicator.text = diagnostics.get_interpretation(editor.document);
			}
		}));
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(listener => {
			if (listener)
			{
				addressCompletions.rebuild();
				versionIndicator.text = vscode.workspace.getConfiguration('merlin6502').get('version') as string;
				vscode.languages.registerDocumentSemanticTokensProvider(selector,tokens,legend);
			}
		}));
	});
}
