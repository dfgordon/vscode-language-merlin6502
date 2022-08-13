import * as vscode from 'vscode';
import * as vsclnt from 'vscode-languageclient';
import * as lxbase from './langExtBase';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { spawn } from 'child_process';
import * as path from 'path';
import { platform } from 'os';
import { client } from './extension';

type DisassemblyParams = {
	getWhat: string,
	addrRange: [number, number],
	xc: number,
	label: string
}

async function proceedDespiteErrors(document: vscode.TextDocument,actionDesc: string,rng: vscode.Range | undefined) : Promise<boolean>
{
	const collection = vscode.languages.getDiagnostics(document.uri);
	let err = false;
	collection.forEach(d => {
		if (d.severity==vscode.DiagnosticSeverity.Error)
			if (!rng || (rng && d.range.start.line >= rng.start.line && d.range.end.line <= rng.end.line ))
				err = true;
	});
	if (err)
	{
		const result = await vscode.window.showWarningMessage(
			actionDesc + ' with errors is not recommended.  Proceed anyway?',
			'Proceed','Cancel');
		if (result!='Proceed')
			return false;
	}
	return true;
}

export class FormattingTool
{
	async showPasteableProgram(): Promise<string|undefined>
	{
		let verified = lxbase.verify_document();
		if (!verified)
			return;
		const proceed = await proceedDespiteErrors(verified.doc,'Formatting',undefined);
		if (!proceed)
			return;
		verified = lxbase.verify_document();
		if (!verified)
			return;
		const formattedCode = await client.sendRequest(vsclnt.ExecuteCommandRequest.type,
			{
				command: 'merlin6502.pasteFormat',
				arguments: [
					verified.doc.getText().split('\n'),
					verified.doc.uri.toString()
				]
			});
		vscode.workspace.openTextDocument({content: formattedCode, language: 'merlin6502'}).then(doc => {
			vscode.window.showTextDocument(doc);
		});
		return formattedCode;
	}
	async resizeColumns()
	{
		vscode.window.showInformationMessage('Command is retired, please use native VS Code formatting commands');
	}
}

export class DisassemblyTool
{
	async getAddressInput(name: string,min:number,max:number) : Promise<number | undefined>
	{
		const res = await vscode.window.showInputBox({title:'enter '+name+' address'});
		if (res==undefined)
			return;
		const addr = parseInt(res);
		if (addr<min || addr>max)
		{
			vscode.window.showErrorMessage('address is out of range ('+min+'-'+max+')');
			return;
		}
		return addr;
	}
	async getInsertionParameters(max:number) : Promise<DisassemblyParams | undefined>
	{
		const getWhat = await vscode.window.showQuickPick(['Merlin Source','Disassembly: Ranged','Disassembly: Last DOS 3.3 BLOAD','Disassembly: Last ProDOS BLOAD'],{title:'Insert what?'});
		if (!getWhat)
			return;
		let startAddr : number|undefined = 0;
		let endAddr : number|undefined = 0;
		let xc = 0;
		let lbl : string|undefined = 'label every line';
		if (getWhat.substring(0,11)=='Disassembly')
		{
			// if last BLOAD was requested, leave [startAddr,endAddr] as [0,0] and server will update based on memory image
			if (getWhat.slice(-6)=='Ranged')
				startAddr = await this.getAddressInput('starting',0,max-1);
			if (startAddr==undefined)
				return;
			if (getWhat.slice(-6)=='Ranged')
				endAddr = await this.getAddressInput('ending',startAddr+1,max);
			if (endAddr==undefined)
				return;
			const res = await vscode.window.showQuickPick(['6502','65C02','65816'],{title:'Processor Target'});
			if (!res)
				return;
			if (res=='65C02')
				xc = 1;
			if (res=='65816')
				xc = 2;
			lbl = await vscode.window.showQuickPick(['label every line','label some lines','label no lines'],{title:'Label Policy'});
			if (!lbl)
				return;
		}
		return { getWhat: getWhat, addrRange: [startAddr, endAddr], xc: xc, label: lbl };
	}
	getMerlinSource(img: Buffer,auxZP: Buffer|undefined) : string
	{
		const startAddr = auxZP ? auxZP[10] + 256*auxZP[11] : img[10] + 256*img[11];
		const endAddr = auxZP ? auxZP[14] + 256*auxZP[15] : img[14] + 256*img[15];
		let code = '';
		for (let i=startAddr;i<endAddr;i++)
		{
			const charCode = img[i];
			if (charCode<128)
				code += String.fromCharCode(charCode);
			else if (String.fromCharCode(charCode-128)==' ')
				code += '\t';
			else
				code += String.fromCharCode(charCode-128);

		}
		return code;
	}
	openAppleWinSaveState(uri : vscode.Uri[]|undefined) : [[string,string][],[string,string][]] | undefined
	{
		if (!uri)
			return;
		const yamlString = fs.readFileSync(uri[0].fsPath,'utf8');
		const yamlTree : any = YAML.parseAllDocuments(yamlString,{uniqueKeys: false,schema: "failsafe"})[0];
		if (yamlTree.errors.length>0)
		{
			vscode.window.showErrorMessage('Failed to parse YAML');
			return;
		}
		const mainString = yamlTree.contents.items[1].toString();
		const auxString = yamlTree.contents.items[2].toString();
		const block64Map = JSON.parse(mainString)['Unit']['State']['Main Memory'];
		const block64MapAux = JSON.parse(auxString)['Unit']['State']['State']['Auxiliary Memory Bank00'];
		if (!block64Map)
		{
			vscode.window.showErrorMessage('Could not find main memory keys in YAML file');
			return;
		}
		if (!block64MapAux)
		{
			vscode.window.showErrorMessage('Could not find aux memory keys in YAML file');
			return;
		}
		const mainMemList = (Object.entries(block64Map) as [string,string][]).sort();
		const auxMemList = (Object.entries(block64MapAux) as [string,string][]).sort();
		return [mainMemList,auxMemList];
	}
	async insertCode(params:DisassemblyParams,img:Buffer,auxZP:Buffer|undefined)
	{
		let content = '';
		if (params.getWhat.substring(0,11) == 'Disassembly') {
			const img_messg: number[] = Array.from(Uint8Array.from(img));
			content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type,
				{
					command: 'merlin6502.disassemble',
					arguments: [
						img_messg,
						params
					]
				});
		}
		else
			content = this.getMerlinSource(img,auxZP);
		const verified = lxbase.verify_document();
		if (verified && content.length>1)
			verified.ed.edit( edit => { edit.replace(verified.ed.selection,content); });
		else if (verified)
			vscode.window.showWarningMessage('insert failed (no code found)');
		else
			vscode.window.showWarningMessage('insert failed (problem with document)');
	}
	async getAppleWinSaveState()
	{
		const params = await this.getInsertionParameters(2**16);
		if (!params)
			return;
		vscode.window.showOpenDialog({
		"canSelectMany": false,
		"canSelectFiles":true,
		"filters": {"Save state": ["yaml"]},
		"title": "Insert from AppleWin State"
		}).then(uri => {
			const res = this.openAppleWinSaveState(uri);
			if (!res)
				return;
			const [main,aux] = res;
			const buffList = new Array<Buffer>();
			for (const [addr,hexRow] of main)
				buffList.push(Buffer.from(hexRow,"hex"));
			const zpRow = aux[0][1];
			if (!zpRow)
				return;
			this.insertCode(params,Buffer.concat(buffList),Buffer.from(zpRow,"hex"));
		});
	}
	async getFrontVirtualII()
	{
		if (platform() !== 'darwin')
		{
			vscode.window.showWarningMessage('This command is only available on macOS');
			return;
		}
		const params = await this.getInsertionParameters(2**15+2**14);
		if (!params)
			return;
		const warnMess = params.getWhat.substring(0,11)!='Disassembly' ? 'Please verify that Merlin is running in the front machine' : 'Please verify the front machine is ready';
		const res = await vscode.window.showWarningMessage(warnMess,'Proceed','Cancel');
		if (res!='Proceed')
			return;
		const scriptPath = path.join(__dirname,'vscode-to-vii.scpt');
		const dumpPath = path.join(__dirname,'scratch.dump');
		const process = spawn('osascript',[scriptPath,"get",dumpPath]);
		process.stderr.on('data',data => {
			vscode.window.showErrorMessage(`${data}`);
		});
		process.on('close',(code) => {
			if (code===0)
			{
				this.insertCode(params,fs.readFileSync(dumpPath),undefined);
			}
		});
	}
}
