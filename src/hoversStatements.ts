import * as vscode from 'vscode';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';

function exampleString(examples: string[]) : vscode.MarkdownString
{
	const result = new vscode.MarkdownString();
	result.appendMarkdown('**Examples**');
	examples.forEach(s => result.appendCodeblock(s,'merlin6502'));
	return result;
}

function headingString(psop: string,alt: string[]|undefined) : vscode.MarkdownString
{
	const result = new vscode.MarkdownString();
	result.appendMarkdown('`'+psop.toUpperCase()+'`');
	if (alt)
		alt.forEach(s => result.appendMarkdown('or `'+s.toUpperCase()+'`'));
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
		const modeList = obj.modes;
		if (modeList)
		{
			let table = 'addr|cyc|op|xc\n---|---:|---|---\n';
			for (const mode of modeList)
			{
				const addr_mnemonic = (mode.addr_mnemonic as string).padEnd(8,' ');
				const code = '$'+(mode.code as number).toString(16).toUpperCase().padStart(2,'0');
				const cyc = (mode.cycles as number).toString();
				let proc = '';
				if (!mode.processors.includes('6502'))
					proc += '*';
				if (!mode.processors.includes('65c02'))
					proc += '*';
				table += addr_mnemonic+'|'+cyc+'|'+code+'|'+proc+'\n';
			}
			ans.push(new vscode.MarkdownString(table));
		}
		const stat = obj.status as string;
		if (stat)
		{
			let statusTab = 'N|V|M|X|D|I|Z|C\n---|---|---|---|---|---|---|---\n'
			for (let i=0;i<8;i++)
				statusTab += stat.charAt(i) + '|';
			ans.push(new vscode.MarkdownString('status register'));
			ans.push(new vscode.MarkdownString(statusTab));
		}
		this.hmap.set('op_'+op,ans);
	}
	constructor()
	{
		this.hmap = new Map<string,Array<vscode.MarkdownString>>();
			
		for (const op in opcodes)
		{
			this.add(op);
		}
	}
	get(tok : string) : Array<vscode.MarkdownString> | undefined
	{
		return this.hmap.get(tok);
	}
}

export class PseudoOpcodeHovers
{
	hmap: Map<string,Array<vscode.MarkdownString>>;

	add(psop: string)
	{
		const ans = new Array<vscode.MarkdownString>();
		const obj = Object(pseudo)[psop];
		ans.push(headingString(psop,obj.alt));
		ans.push(new vscode.MarkdownString(obj.desc));
		if (obj.eg)
			ans.push(exampleString(obj.eg));
		if (obj.caveat)
			ans.push(new vscode.MarkdownString('n.b. '+obj.caveat));
		let v = 'Merlin versions: ';
		const vmap = obj.version;
		if (vmap)
			for (const it of vmap)
				v += it+', ';
		ans.push(new vscode.MarkdownString(v.substring(0,v.length-2)));
		if (psop=='--^')
			this.hmap.set('psop_end_lup',ans);
		else
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
		return this.hmap.get(tok);
	}
}