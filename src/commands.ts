import * as vscode from 'vscode';
import * as lxbase from './langExtBase';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { spawn } from 'child_process';
import * as path from 'path';
import { platform } from 'os';
import * as opcodes from './opcodes.json';
import * as Parser from 'web-tree-sitter';

type OpData =
{
	// This is the value in a map with opcodes as the key.
	// operand is a template such as (1),y, where the decimal
	// digit is the bytes of binary data, as well as a placeholder.
	// xc is the number of XC pseudo-ops needed to enable.
	mnemonic : string,
	operand : string,
	xc : number,
	relative : boolean,
	immediate : boolean
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

export class DisassemblyTool extends lxbase.LangExtBase // do we need LangExtBase here?
{
	disassemblyMap : Map<number,OpData>;
	formattedLine = "";
	formattedCode = "";
	callToken = '\u0100';
	persistentSpace = '\u0100';
	constructor(TSInitResult : [Parser,Parser.Language,Parser.Language,boolean])
	{
		super(TSInitResult);
		// This map creates a string where we can simply search for a number,
		// and the number is the length of the binary data.  Furthermore,
		// the value of the data replaces the number.
		const modeMap = new Map<string,string>([
			['imm', '#1'], // 2 if 16 bit mode on 65816
			['abs', '2'],
			['zp', '1'],
			['rel', '1'],
			['rell', '2'],
			['absl', '3'],
			['(zp,x)', '(1,x)'],
			['(abs,x)', '(2,x)'],
			['(zp),y', '(1),y'],
			['zp,x', '1,x'],
			['abs,x', '2,x'],
			['absl,x', '3,x'],
			['zp,y', '1,y'],
			['abs,y', '2,y'],
			['(abs)', '(2)'],
			['(zp)', '(1)'],
			['[d]', '[1]'],
			['[d],y', '[1],y'],
			['d,s', '1,s'],
			['(d,s),y', '(1,s),y'],
			['xyc', '11']
		]);
		this.disassemblyMap = new Map<number,OpData>();
		for (const key in opcodes)
		{
			const modes = Object(opcodes)[key].modes;
			if (!modes)
				continue;
			for (const mode of modes)
			{
				const operandStr = modeMap.get(mode.addr_mnemonic);
				const processors = mode.processors;
				const rel = mode.addr_mnemonic.substring(0,3)=='rel';
				const imm = mode.addr_mnemonic=='imm';
				if (processors && processors.includes('6502'))
					this.disassemblyMap.set(mode.code,{mnemonic:key,operand:operandStr ? operandStr:'0',xc:0,relative:rel,immediate:imm});
				else if (processors && processors.includes('65c02'))
					this.disassemblyMap.set(mode.code,{mnemonic:key,operand:operandStr ? operandStr:'0',xc:1,relative:rel,immediate:imm});
				else
					this.disassemblyMap.set(mode.code,{mnemonic:key,operand:operandStr ? operandStr:'0',xc:2,relative:rel,immediate:imm});
			}
		}
	}
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
	replace_curs(newNodeText: string, curs: Parser.TreeCursor) : string
	{
		const preNode = this.formattedLine.substring(0,curs.startPosition.column);
		const postNode = this.formattedLine.substring(curs.endPosition.column);
		return preNode + newNodeText + ' '.repeat(curs.nodeText.length-newNodeText.length) + postNode;
	}
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
	async getInsertionParameters(max:number) : Promise<[[number,number],number,string,string] | undefined>
	{
		const getWhat = await vscode.window.showQuickPick(['Disassembly','Merlin Source'],{title:'Insert what?'});
		if (!getWhat)
			return;
		let startAddr : number|undefined = 0;
		let endAddr : number|undefined = 0;
		let xc = 0;
		let lbl : string|undefined = 'label every line';
		if (getWhat=='Disassembly')
		{
			startAddr = await this.getAddressInput('starting',0,max-1);
			if (!startAddr)
				return;
			endAddr = await this.getAddressInput('ending',startAddr+1,max);
			if (!endAddr)
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
		return [[startAddr,endAddr],xc,getWhat,lbl];
	}
	getMerlinSource(img: Buffer,auxZP: Buffer|undefined) : string
	{
		const startAddr = auxZP ? auxZP[10] + 256*auxZP[11] : img[10] + 256*img[11];
		const endAddr = auxZP ? auxZP[14] + 256*auxZP[15] : img[14] + 256*img[15];
		let code = '';
		for (let i=startAddr;i<endAddr;i++)
		{
			let charCode = img[i];
			if (charCode<128)
				code += String.fromCharCode(charCode);
			else if (String.fromCharCode(charCode-128)==' ')
				code += '\t';
			else
				code += String.fromCharCode(charCode-128);

		}
		return code;
	}
	disassemble(img: Buffer, rng: [number,number], xc: number, lbl: string) : string
	{
		let addr = rng[0];
		let code = '';
		const addresses = new Array<number>();
		const references = new Set<number>();
		const labels = new Set<number>();
		const instructions = new Array<string>();
		const operands = new Array<string>();
		const operand_vals = new Array<number>();
		while (addr<rng[1])
		{
			addresses.push(addr);
			const op = this.disassemblyMap.get(img[addr]);
			if (op && xc>=op.xc)
			{
				instructions.push(op.mnemonic.toUpperCase());
				addr += 1;
				const moveOpMatch = op.operand.match(/[0-9][0-9]/);
				const ordinaryMatch = op.operand.match(/[0-9]/);
				if (ordinaryMatch && !moveOpMatch)
				{
					const bytes = parseInt(ordinaryMatch[0]);
					if (bytes>0 && addr+bytes<=rng[1])
					{
						let val = 0;
						for (let i=0;i<bytes;i++)
							val += img[addr+i]*(256**i);
						if (op.relative)
							val += addr + bytes;
						if (!op.immediate)
							references.add(val);
						if (op.relative)
							operands.push(op.operand.replace(bytes.toString(),'$'+val.toString(16).padStart(2+bytes*2,'0')).toUpperCase());
						else
							operands.push(op.operand.replace(bytes.toString(),'$'+val.toString(16).padStart(bytes*2,'0')).toUpperCase());
						operand_vals.push(val);
					}
					else
					{
						operands.push('');
						operand_vals.push(-1);
					}
					addr += bytes;
				}
				if (moveOpMatch && addr+1<rng[1])
				{
					const hex1 = '$' + img[addr].toString(16).padStart(2,'0').toUpperCase();
					const hex2 = '$' + img[addr+1].toString(16).padStart(2,'0').toUpperCase();
					operands.push(op.operand.replace('11',hex1+','+hex2));
					operand_vals.push(-1);
					addr += 2;
				}
			}
			else
			{
				instructions.push('DFB');
				operands.push('$' + img[addr].toString(16).padStart(2,'0').toUpperCase());
				operand_vals.push(-1);
				addr += 1;
			}
		}
		// first pass determine labels
		for (let i=0;i<addresses.length;i++)
		{
			if (lbl.includes('every'))
				labels.add(addresses[i]);
			else if (lbl.includes('some') && references.has(addresses[i]))
				labels.add(addresses[i]);
		}
		for (let i=0;i<addresses.length;i++)
		{
			if (labels.has(addresses[i]))
				code += '_'+addresses[i].toString(16).padStart(4,'0').toUpperCase();
			code += '\t' + instructions[i];
			if (labels.has(operand_vals[i]))
				code += '\t' + operands[i].replace('$','_');
			else if (operands[i].length>0)
				code += '\t' + operands[i];
			code += '\n';
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
	insertCode(params:[[number,number],number,string,string],img:Buffer,auxZP:Buffer|undefined)
	{
		const [addrRange,xc,getWhat,lbl] = params;
		let content = '';
		if (getWhat=='Disassembly')
			content = this.disassemble(img,addrRange,xc,lbl);
		else
			content = this.getMerlinSource(img,auxZP);
		const verified = this.verify_document();
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
		const [addrRange,xc,getWhat] = params;
		const warnMess = getWhat!='Disassembly' ? 'Please verify that Merlin is running in the front machine' : 'Please verify the front machine is ready';
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
	format_node(curs: Parser.TreeCursor) : lxbase.WalkerChoice
	{
		// Persistent spaces
		if (['literal_arg','dstring','dos33','anyfs','literal','comment_text'].includes(curs.nodeType))
			this.formattedLine = this.replace_curs(curs.nodeText.replace(/ /g,this.persistentSpace),curs);
		return lxbase.WalkerOptions.gotoChild;
	}
	async showPasteableProgram()
	{
		let verified = this.verify_document();
		if (!verified)
			return;
		const proceed = await proceedDespiteErrors(verified.doc,'Formatting');
		if (!proceed)
			return;
		verified = this.verify_document();
		if (!verified)
			return;
		this.GetLabels(verified.doc);
		this.formattedCode = '';
		for (this.row=0;this.row<verified.doc.lineCount;this.row++)
		{
			this.formattedLine = this.AdjustLine(verified.doc);
			const tree = this.parse(this.formattedLine,"\n");
			this.walk(tree,this.format_node.bind(this));
			this.formattedCode += this.formattedLine.
				replace(RegExp('^'+this.callToken),'').
				replace(/\s+/g,' ').
				replace(RegExp(this.persistentSpace,'g'),' ');
			this.formattedCode += '\n';
		}
		vscode.workspace.openTextDocument({content:this.formattedCode,language:'merlin6502'}).then(doc => {
			vscode.window.showTextDocument(doc);
		});
	}
	async resizeColumns()
	{
		let verified = this.verify_document();
		if (!verified)
			return;
		const proceed = await proceedDespiteErrors(verified.doc,'Formatting');
		if (!proceed)
			return;
		const widths = [
			this.config.get('columns.c1') as number,
			this.config.get('columns.c2') as number,
			this.config.get('columns.c3') as number
		]
		verified = this.verify_document();
		if (!verified)
			return;
		this.GetLabels(verified.doc);
		const sel = verified.ed.selection;
		let formattedDoc = ''
		for (this.row=0;this.row<verified.doc.lineCount;this.row++)
		{
			if (sel.isEmpty || (this.row>=sel.start.line && this.row<sel.end.line))
			{
				this.formattedLine = this.AdjustLine(verified.doc);
				const tree = this.parse(this.formattedLine,"\n");
				this.walk(tree,this.format_node.bind(this));
				this.formattedLine = this.formattedLine.replace(RegExp('^'+this.callToken),'').replace(/\s+/g,' ');
				const cols = this.formattedLine.split(' ');
				this.formattedLine = '';
				for (let i=0;i<cols.length;i++)
				{
					let prepadding = 0;
					if (cols[i].charAt(0)==';')
						for (let j=i;j<3;j++)
							prepadding += widths[j];
					const padding = widths[i] - cols[i].length;
					this.formattedLine += ' '.repeat(prepadding) + cols[i] + (padding>0 ? ' '.repeat(padding) : ' ');
				}
				this.formattedLine = this.formattedLine.trimEnd().replace(RegExp(this.persistentSpace,'g'),' ');
				formattedDoc += this.formattedLine;
			}
			else
				formattedDoc += verified.doc.lineAt(this.row).text;
			if (this.row<verified.doc.lineCount-1)
				formattedDoc += '\n'
		}
		const start = new vscode.Position(0,0);
		const end = new vscode.Position(verified.doc.lineCount,0);
		verified.ed.edit( edit => { edit.replace(new vscode.Range(start,end),formattedDoc) } );
	}
}
