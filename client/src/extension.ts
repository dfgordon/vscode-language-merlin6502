import * as vscode from 'vscode';
import * as tok from './semanticTokens';
import * as lxbase from './langExtBase';
import * as com from './commands';
import * as dasm from './disassembly';
import * as dimg from './diskImage';
import * as vsclnt from 'vscode-languageclient/node';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export let client: vsclnt.LanguageClient;

/** convert arch-platform to rust convention */
function targetTriple(): string[] {
	const ans = [];
	
	// CPU part
	if (os.arch() == "arm64") {
		ans.push("aarch64");
	} else if (os.arch() == "x64") {
		ans.push("x86_64");
	} else {
		ans.push("unknown");
	}

	// Vendor part
	if (os.platform() == "darwin") {
		ans.push("apple");
	} else if (os.platform() == "linux") {
		ans.push("unknown");
	} else if (os.platform() == "win32") {
		ans.push("pc");
	} else {
		ans.push("unknown");
	}

	// OS-ABI part
	if (os.platform() == "darwin") {
		ans.push("darwin");
	} else if (os.platform() == "linux") {
		ans.push("linux-musl");
	} else if (os.platform() == "win32") {
		ans.push("windows-msvc.exe");
	} else {
		ans.push("unknown");
	}

	return ans;
}

function getExecutableNames(context: vscode.ExtensionContext): string[] {
	const ans = [];
	const [cpu, vendor, opSys] = targetTriple();
	const bundled = "server-merlin" + "-" + cpu + "-" + vendor + "-" + opSys;
	ans.push(context.asAbsolutePath(path.join('server', bundled)));
	const external = "server-merlin" + (opSys.endsWith(".exe") ? ".exe" : "");
	ans.push(path.join(os.homedir(),".cargo","bin",external));
	return ans;
}

/** this runs after the extension loads */
export function activate(context: vscode.ExtensionContext)
{
	const serverCommandOptions = getExecutableNames(context);
	let serverCommand: string | undefined = undefined;
	for (const cmd of serverCommandOptions) {
		if (fs.existsSync(cmd)) {
			try {
				fs.accessSync(cmd, fs.constants.X_OK);
			} catch (err) {
				fs.chmodSync(cmd, fs.constants.S_IXUSR | fs.constants.S_IRUSR | fs.constants.S_IXGRP | fs.constants.S_IXOTH);
			}
			serverCommand = cmd;
			break;
		}
	}
	if (!serverCommand) {
		vscode.window.showErrorMessage("Neither a bundled nor an installed server could be found for this platform.  You may be able to solve this with `cargo install a2kit`.");
		return;
	}
	
	const serverOptions: vsclnt.ServerOptions = {
		command: serverCommand,
		//args: ["--log-level","off","--suppress-tokens"],
		args: ["--log-level","off"],
		//args: ["--log-level","trace"],
		transport: vsclnt.TransportKind.stdio
	};
	const clientOptions: vsclnt.LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'merlin6502' }],
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{S,asm}')
		}
	};

	client = new vsclnt.LanguageClient('merlin6502', 'Merlin 6502', serverOptions, clientOptions);
	client.start().then(() => {
		if (client.initializeResult?.serverInfo?.version) {
			const vstr = client.initializeResult.serverInfo.version;
			client.outputChannel.appendLine("Server version is " + vstr);
			const v= vstr.split('.')
			if (parseInt(v[0]) != 4) {
				vscode.window.showErrorMessage('Server version is ' + vstr + ', expected 4.x, stopping.');
				client.stop();
			}
		} else {
			vscode.window.showErrorMessage('unable to check server version, continuing anyway...');
		}
	});
	client.outputChannel.appendLine("using server " + serverCommand);

	const versionIndicator = vscode.window.createStatusBarItem();
	const typeIndicator = vscode.window.createStatusBarItem();
	const contextIndicator = vscode.window.createStatusBarItem();
	const rescanButton = vscode.window.createStatusBarItem();
	versionIndicator.text = vscode.workspace.getConfiguration('merlin6502').get('version') as string;
	versionIndicator.tooltip = "Merlin version being targeted (see settings)";
	typeIndicator.text = "pending";
	typeIndicator.tooltip = "Relationship to other files";
	contextIndicator.text = "pending";
	contextIndicator.tooltip = "File defining context of analysis";
	contextIndicator.command = "merlin6502.client.selectMaster";
	rescanButton.text = "rescan";
	rescanButton.tooltip = "rescan modules and includes";
	rescanButton.command = "merlin6502.client.rescan";

	// const highlighter = new tok.SemanticTokensProvider();
	// highlighter.register();

	const emulator = new com.EmulatorTool(context);
	const a2kit = new dimg.A2KitTool(context);
	const masterSelect = new com.MasterSelect(contextIndicator);
	const rescanner = new com.RescanTool(rescanButton);

	const startEditor = vscode.window.activeTextEditor;
	if (startEditor?.document.languageId=='merlin6502') {
		versionIndicator.show();
		typeIndicator.show();
		contextIndicator.show();
		rescanButton.show();
	}

	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.client.getFrontVii",emulator.getFrontVirtualII,emulator));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.client.getAppleWinSaveState",emulator.getAppleWinSaveState,emulator));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.client.format",com.showPasteableProgram));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.client.toData", dasm.toData));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.client.toCode", dasm.toCode));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.client.getFromDiskImage", a2kit.getFromImage, a2kit));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.client.saveToDiskImage", a2kit.putToImage, a2kit));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.client.selectMaster", masterSelect.selectMaster, masterSelect));
	context.subscriptions.push(vscode.commands.registerCommand("merlin6502.client.rescan", rescanner.rescan, rescanner));

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor?.document.languageId == 'merlin6502') {
			typeIndicator.text = "pending";
			contextIndicator.text = "pending";
			versionIndicator.show();
			typeIndicator.show();
			contextIndicator.show();
			rescanButton.show();
			if (vscode.workspace.workspaceFolders) {
				try {
					lxbase.request<null>("merlin6502.activeEditorChanged", [
						editor.document.uri.toString()
					]);
				} catch (error) {
					if (error instanceof Error)
						vscode.window.showErrorMessage(error.message);
				}
			}
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