import * as vscode from 'vscode';
import * as lxbase from './langExtBase';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { spawn } from 'child_process';
import * as path from 'path';
import { platform } from 'os';
import * as srcEncoding from './sourceEncoding';
import { DisassemblyTool, DasmParams, DasmRange } from './disassembly';

async function insertWhat() : Promise<string | undefined>
{
	return await vscode.window.showQuickPick(['Merlin Source', 'Disassembly: Ranged', 'Disassembly: Last DOS 3.3 BLOAD', 'Disassembly: Last ProDOS BLOAD'], { title: 'Insert what?' });
}

function dasm_range_type(s: string): DasmRange {
	if (s.includes("Ranged")) {
		return DasmRange.Range;
	} else if (s.includes("3.3")) {
		return DasmRange.LastBloadDos33;
	} else if (s.includes("ProDOS")) {
		return DasmRange.LastBloadProdos;
	} else {
		return DasmRange.All;
	}
}

export async function showPasteableProgram(): Promise<string|undefined>
{
	let verified = lxbase.verify_document();
	if (!verified)
		return;
	const proceed = await lxbase.proceedDespiteErrors(verified.doc,'Formatting',undefined);
	if (!proceed)
		return;
	verified = lxbase.verify_document();
	if (!verified)
		return;
	try {
		const formattedCode = await lxbase.request<string>('merlin6502.pasteFormat', [
			verified.doc.getText(),
			verified.doc.uri.toString()
		]);
		vscode.workspace.openTextDocument({ content: formattedCode, language: 'merlin6502' }).then(doc => {
			vscode.window.showTextDocument(doc);
		});
		return formattedCode;
	} catch (error) {
		if (error instanceof Error)
			vscode.window.showErrorMessage(error.message);
	}
}

export class MasterSelect
{
	contextIndicator: vscode.StatusBarItem;
	constructor(ind: vscode.StatusBarItem) {
		this.contextIndicator = ind;
	}
	async selectMaster()
	{
		let verified = lxbase.verify_document();
		if (!verified)
			return;
		const display_uri = verified.doc.uri;
		try {
			const master_list = await lxbase.request<string[]>('merlin6502.getMasterList', [display_uri.toString()]);
			if (!master_list)
				return;
			const sel = await vscode.window.showQuickPick(master_list);
			if (!sel)
				return;
			verified = lxbase.verify_document();
			if (!verified)
				return;
			if (verified.doc.uri != display_uri)
				return;
			await lxbase.request<null>('merlin6502.selectMaster', [display_uri.toString(),sel]);
			//verified.ed.edit(edit => { edit.insert(new vscode.Position(0,0),"")});
			this.contextIndicator.text = path.basename(sel);
		} catch (error) {
			if (error instanceof Error)
				vscode.window.showErrorMessage(error.message);
		}
	}
}

export class RescanTool
{
	rescanButton: vscode.StatusBarItem;
	constructor(ind: vscode.StatusBarItem) {
		this.rescanButton = ind;
	}
	rescan()
	{
		const verified = lxbase.verify_document();
		if (!verified)
			return;
		try {
			lxbase.request<null>('merlin6502.rescan', [verified.doc.uri.toString()]);
			//verified.ed.edit(edit => { edit.insert(new vscode.Position(0,0),"")});
		} catch (error) {
			if (error instanceof Error)
				vscode.window.showErrorMessage(error.message);
		}
	}
}

export class EmulatorTool extends lxbase.LangExtBase
{
	openAppleWinSaveState(uri : vscode.Uri[]|undefined) : [[string,string][],[string,string][]] | undefined
	{
		if (!uri)
			return;
		const yamlString = fs.readFileSync(uri[0].fsPath,'utf8');
		const yamlTree = YAML.parseAllDocuments(yamlString,{uniqueKeys: false,schema: "failsafe"})[0];
		if (yamlTree.errors.length == 0 && YAML.isMap(yamlTree.contents)) {
			// The following gets two values with the same key by assuming an ordering.
			// We are forced to do this inadvisable thing due to the way AppleWin creates the YAML.
			const mainString = yamlTree.contents.items[1].toString();
			const auxString = yamlTree.contents.items[2].toString();
			const block64Map = JSON.parse(mainString)['Unit']['State']['Main Memory'];
			const block64MapAux = JSON.parse(auxString)['Unit']['State']['State']['Auxiliary Memory Bank00'];
			if (!block64Map) {
				vscode.window.showErrorMessage('Could not find main memory keys in YAML file');
				return;
			}
			if (!block64MapAux) {
				vscode.window.showErrorMessage('Could not find aux memory keys in YAML file');
				return;
			}
			// n.b. if AppleWin ever changes the format of the keys we may need to provide sorting function
			const mainMemList = (Object.entries(block64Map) as [string, string][]).sort();
			const auxMemList = (Object.entries(block64MapAux) as [string, string][]).sort();
			return [mainMemList, auxMemList];
		}
		vscode.window.showErrorMessage('Failed to parse YAML');
		return;
	}
	async getAppleWinSaveState()
	{
		const getWhat = await insertWhat();
		if (!getWhat)
			return;
		const uri = await vscode.window.showOpenDialog({
			"canSelectMany": false,
			"canSelectFiles": true,
			"filters": { "Save state": ["yaml"] },
			"title": "Insert from AppleWin State"
		});
		if (!uri) {
			return;
		}
		const res = this.openAppleWinSaveState(uri);
		if (!res) {
			// error message already given
			return;
		}
		const [main,aux] = res;
		const buffList = new Array<Buffer>();
		let last_addr = -1;
		for (const [addr, hexRow] of main) {
			const curr_addr = parseInt(addr, 16);
			if (curr_addr < last_addr) {
				vscode.window.showErrorMessage("sanity check failed while parsing save state's main memory");
				return;
			}
			buffList.push(Buffer.from(hexRow, "hex"));
			last_addr = curr_addr;
		}
		const zpRow = aux[0][1];
		if (!zpRow) {
			vscode.window.showErrorMessage("could not load auxilliary zero page from save state");
			return;
		}
		if (getWhat == "Merlin Source") {
			srcEncoding.insert_from_ram_image(Buffer.concat(buffList), Buffer.from(zpRow, "hex"));
		} else {
			const dasm = new DisassemblyTool();
			const params = await dasm.getDisassemblyParameters(dasm_range_type(getWhat), 0, 2 ** 16);
			if (params) {
				dasm.insertCode(params, Buffer.concat(buffList));
			}
		}
	}
	async getFrontVirtualII()
	{
		if (platform() !== 'darwin')
		{
			vscode.window.showWarningMessage('This command is only available on macOS');
			return;
		}
		const getWhat = await insertWhat();
		if (!getWhat)
			return;
		let dasm: DisassemblyTool;
		let params: DasmParams | undefined;
		if (getWhat.includes("Disassembly")) {
			dasm = new DisassemblyTool();
			params = await dasm.getDisassemblyParameters(dasm_range_type(getWhat), 0, 2 ** 16);
		}
		const warnMess = getWhat.includes('Disassembly') ? 'Please verify that Merlin is running in the front machine' : 'Please verify the front machine is ready';
		const res = await vscode.window.showWarningMessage(warnMess,'Proceed','Cancel');
		if (res!='Proceed')
			return;
		const scriptPath = path.join(this.binPath,'vscode-to-vii.scpt');
		const dumpPath = path.join(this.binPath,'scratch.dump');
		const process = spawn('osascript',[scriptPath,"get",dumpPath]);
		process.stderr.on('data',data => {
			vscode.window.showErrorMessage(`${data}`);
		});
		process.on('close',(code) => {
			if (code === 0) {
				if (getWhat == "Merlin Source") {
					srcEncoding.insert_from_ram_image(fs.readFileSync(dumpPath), undefined);
				} else {
					if (params) {
						dasm.insertCode(params, fs.readFileSync(dumpPath));
					}
				}
			}
		});
	}
}
