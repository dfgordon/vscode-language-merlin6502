import * as vscode from 'vscode';
import * as com from './commands';
import * as dimg from './diskImage';
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

	const versionIndicator = vscode.window.createStatusBarItem();
	const typeIndicator = vscode.window.createStatusBarItem();
	const contextIndicator = vscode.window.createStatusBarItem();
	const rescanButton = vscode.window.createStatusBarItem();
	versionIndicator.text = vscode.workspace.getConfiguration('merlin6502').get('version') as string;
	versionIndicator.tooltip = "Merlin version being targeted (see settings)";
	typeIndicator.text = "pending";
	typeIndicator.tooltip = "How the file is interpreted, as source or linker commands";
	contextIndicator.text = "pending";
	contextIndicator.tooltip = "File defining context of analysis";
	contextIndicator.command = "merlin6502.selectMaster";
	rescanButton.text = "rescan";
	rescanButton.tooltip = "rescan modules and includes";
	rescanButton.command = "merlin6502.rescan";

	const disassembler = new com.DisassemblyTool();
	const formatter = new com.FormattingTool();
	const a2kit = new dimg.A2KitTool();
	const masterSelect = new com.MasterSelect(contextIndicator);
	const rescanner = new com.RescanTool(rescanButton);

	const startEditor = vscode.window.activeTextEditor;
	if (startEditor?.document.languageId=='merlin6502') {
		versionIndicator.show();
		typeIndicator.show();
		contextIndicator.show();
		rescanButton.show();
	}

	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getFrontVii",disassembler.getFrontVirtualII,disassembler));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getAppleWinSaveState",disassembler.getAppleWinSaveState,disassembler));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.format",formatter.showPasteableProgram,formatter));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.columns", formatter.resizeColumns, formatter));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.getFromDiskImage", a2kit.getFromImage, a2kit));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.saveToDiskImage", a2kit.putToImage, a2kit));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.selectMaster", masterSelect.selectMaster, masterSelect));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.rescan", rescanner.rescan, rescanner));

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor?.document.languageId == 'merlin6502') {
			typeIndicator.text = "pending";
			contextIndicator.text = "pending";
			versionIndicator.show();
			typeIndicator.show();
			contextIndicator.show();
			rescanButton.show();
			client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
				command: 'merlin6502.activeEditorChanged',
				arguments: [editor.document.uri.toString()]
			});
		} else {
			versionIndicator.hide();
			typeIndicator.hide();
			contextIndicator.hide();
			rescanButton.hide();
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
	client.onNotification<string>(new vsclnt.NotificationType<string>('merlin6502.context'), params => {
		contextIndicator.text = params;
	});
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}