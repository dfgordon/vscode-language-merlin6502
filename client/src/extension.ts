import * as vscode from 'vscode';
import * as com from './commands';
import * as vsclnt from 'vscode-languageclient/node';
import * as path from 'path';

export let client: vsclnt.LanguageClient;

/// This function runs when the extension loads.
/// It creates the parser object, sets up the providers, and sets up event callbacks.
export function activate(context: vscode.ExtensionContext)
{
	const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
	const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
	const serverOptions: vsclnt.ServerOptions = {
		run: { module: serverModule, transport: vsclnt.TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: vsclnt.TransportKind.ipc,
			options: debugOptions
		}
	};
	const clientOptions: vsclnt.LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'merlin6502' }],
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{S,asm}')
		}
	};

	client = new vsclnt.LanguageClient('merlin6502', 'Merlin 6502', serverOptions, clientOptions);
	client.start();
	const disassembler = new com.DisassemblyTool();
	const formatter = new com.FormattingTool();

	const versionIndicator = vscode.window.createStatusBarItem();
	const typeIndicator = vscode.window.createStatusBarItem();
	versionIndicator.text = vscode.workspace.getConfiguration('merlin6502').get('version') as string;
	versionIndicator.tooltip = 'Merlin version begin targeted (see settings)';
	typeIndicator.text = 'source';
	typeIndicator.tooltip = 'How the file is interpreted, as source or linker commands'

	const startEditor = vscode.window.activeTextEditor;
	if (startEditor?.document.languageId=='merlin6502') {
		versionIndicator.show();
		typeIndicator.show();
	}

	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getFrontVii",disassembler.getFrontVirtualII,disassembler));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getAppleWinSaveState",disassembler.getAppleWinSaveState,disassembler));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.format",formatter.showPasteableProgram,formatter));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.columns", formatter.resizeColumns, formatter));

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor?.document.languageId == 'merlin6502') {
			//client.sendRequest('merlin6502.didChangeActiveEditor',editor.document.uri.toString());
			versionIndicator.show();
			typeIndicator.show();
		} else {
			versionIndicator.hide();
			typeIndicator.hide();
		}
	}));

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(listener => {
		if (listener) {
			versionIndicator.text = vscode.workspace.getConfiguration('merlin6502').get('version') as string;
		}
	}));

	client.onNotification<string>(new vsclnt.NotificationType<string>('merlin6502.interpretation'), params => {
		typeIndicator.text = params;
	});
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}