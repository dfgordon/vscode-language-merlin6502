import * as vscode from 'vscode';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';

function exampleString(examples: string[]) : vscode.MarkdownString
{
	const result = new vscode.MarkdownString();
	examples.forEach(s => result.appendCodeblock(s,'merlin6502'));
	return result;
}

export class OpcodeHovers
{
	hmap: Map<string,Array<vscode.MarkdownString>>;

	add(op: string)
	{
		const ans = new Array<vscode.MarkdownString>();
		const obj = Object(opcodes)[op];
		ans.push(new vscode.MarkdownString('`'+op.toUpperCase()+'`'));
		ans.push(new vscode.MarkdownString(obj.desc));
		let proc = 'Processors: '
		const procMap = obj.processors;
		for (var it in procMap)
			proc += procMap[it]+', ';
		ans.push(new vscode.MarkdownString(proc.substring(0,proc.length-2)));
		this.hmap.set('op_'+op,ans);
	}
	constructor()
	{
		this.hmap = new Map<string,Array<vscode.MarkdownString>>();
			
		for (const op in opcodes)
		{
			//const desc = Object(opcodes)[op].desc;
			//const proc = Object(opcodes)[op].processors;
			//const status = Object(opcodes)[op].status;
			this.add(op);
		}
	}
	get(tok : string) : Array<vscode.MarkdownString> | undefined
	{
		const parts = tok.split('_');
		if (parts.length>1)
			return this.hmap.get(parts[0]+'_'+parts[1]);
		return undefined;
	}
}

export class PseudoOpcodeHovers
{
	hmap: Map<string,Array<vscode.MarkdownString>>;

	add(psop: string)
	{
		const ans = new Array<vscode.MarkdownString>();
		const obj = Object(pseudo)[psop];
		ans.push(new vscode.MarkdownString('`'+psop.toUpperCase()+'`'));
		ans.push(new vscode.MarkdownString(obj.desc));
		let v = 'Merlin versions: '
		const vmap = obj.version;
		for (var it in vmap)
			v += vmap[it]+', ';
		ans.push(new vscode.MarkdownString(v.substring(0,v.length-2)));
		this.hmap.set('psop_'+psop,ans);
	}
	constructor()
	{
		this.hmap = new Map<string,Array<vscode.MarkdownString>>();
			
		for (const psop in pseudo)
		{
			this.add(psop);
		}
	}
	get(tok : string) : Array<vscode.MarkdownString> | undefined
	{
		const parts = tok.split('_');
		if (parts.length>1)
			return this.hmap.get(parts[0]+'_'+parts[1]);
		return undefined;
	}
}