import * as vscode from 'vscode';
import * as lxbase from './langExtBase';
import * as fs from 'fs';
import * as YAML from 'yaml';

/// return a range that expands the selection minimally to encompass complete lines
function extended_selection(textEditor: vscode.TextEditor) : vscode.Range | undefined
{
	const sel = textEditor.selection;
	if (!sel.isEmpty)
	{
		const ext_start = new vscode.Position(sel.start.line,0);
		let ext_end = undefined;
		if (sel.end.character==0)
			ext_end = textEditor.document.lineAt(sel.end.line-1).range.end;
		else
			ext_end = textEditor.document.lineAt(sel.end.line).range.end;
		return new vscode.Range(ext_start,ext_end);
	}
	return undefined;
}

async function proceedDespiteErrors(document: vscode.TextDocument,actionDesc: string) : Promise<boolean>
{
	const collection = vscode.languages.getDiagnostics(document.uri);
	let err = false;
	collection.forEach(d => {
		if (d.severity==vscode.DiagnosticSeverity.Error)
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

export class DisassemblyTool extends lxbase.LangExtBase
{
	encode_int16(int16: number) : string
	{
		const hiByte = Math.floor(int16/256);
		const loByte = int16 - hiByte*256;
		return String.fromCharCode(loByte) + String.fromCharCode(hiByte);
	}
	to_negative_ascii(raw_str: string) : string
	{
		let negString = '';
		for (let i=0;i<raw_str.length;i++)
			negString += String.fromCharCode(raw_str.charCodeAt(i) + 128);
		return negString;
	}
	buffer_from_raw_str(raw_str: string) : Buffer
	{
		const rawBinary = new Uint8Array(raw_str.length);
		for (let i=0;i<raw_str.length;i++)
			rawBinary[i] = raw_str.charCodeAt(i);
		return Buffer.from(rawBinary);
	}
	hex_from_raw_str(raw_str: string) : string
	{
		const rawBinary = new Uint8Array(this.buffer_from_raw_str(raw_str));
		return [...rawBinary].map(b => b.toString(16).toUpperCase().padStart(2,"0")).join("");
	}
	openAppleWinSaveState(uri : vscode.Uri[]|undefined) : [tree:any|undefined,blockMap:any|undefined,path:fs.PathLike|undefined]
	{
		if (!uri)
			return [undefined,undefined,undefined];
		const yamlString = fs.readFileSync(uri[0].fsPath,'utf8');
		const yamlTree : any = YAML.parseAllDocuments(yamlString,{uniqueKeys: false,schema: "failsafe"})[0];
		if (yamlTree.errors.length>0)
		{
			vscode.window.showErrorMessage('Failed to parse YAML');
			return [undefined,undefined,undefined];
		}
		const block64Map = yamlTree.getIn(['Unit','State','Main Memory']);
		if (!block64Map)
		{
			vscode.window.showErrorMessage('Could not find keys in YAML file');
			return [undefined,undefined,undefined];
		}
		return [yamlTree,block64Map,uri[0].fsPath];
	}
	getAppleWinSaveState()
	{
		const verified = this.verify_document();
		if (!verified)
			return;
		vscode.window.showOpenDialog({
			"canSelectMany": false,
			"canSelectFiles":true,
			"filters": {"Save state": ["yaml"]},
			"title": "Insert from AppleWin State"
		}).then(uri => {
			const [yamlTree,block64Map,yamlPath] = this.openAppleWinSaveState(uri);
			if (!yamlTree || !block64Map || !yamlPath)
				return;
			const buffList = new Array<Buffer>();
			for (const p of block64Map.items)
				buffList.push(Buffer.from(p.value.value,"hex"));
			const img = Buffer.concat(buffList);
			const code = 'placeholder';
			if (code.length>1)
				verified.ed.edit( edit => { edit.replace(verified.ed.selection,code); });
			else
				vscode.window.showWarningMessage('no program was found to insert');
		});
	}
	flipAsciiSign(ascii : string) : string
	{
		let ans = '';
		for (let i=0;i<ascii.length;i++)
		{
			const c = ascii.charCodeAt(i);
			ans += c > 127 ? String.fromCharCode(c-128) : String.fromCharCode(c+128);
		}
		return ans;
	}
	async showPasteableProgram()
	{
		let verified = this.verify_document();
		if (!verified)
			return;
		const proceed = await proceedDespiteErrors(verified.doc,'Tokenizing');
		if (!proceed)
			return;
		verified = this.verify_document();
		if (!verified)
			return;
		const content = verified.doc.getText().replace(/[ \t]+/g,' ');
		vscode.workspace.openTextDocument({content:content}).then(doc => {
			vscode.window.showTextDocument(doc);
		});
	}
}
