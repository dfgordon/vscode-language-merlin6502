import * as vscode from 'vscode';
import * as Parser from 'web-tree-sitter';
import * as specialAddresses from './specialAddresses.json';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';
import * as lxbase from './langExtBase';
import * as labels from './labels';

export class AddressCompletionProvider implements vscode.CompletionItemProvider
{
	pokeCompletions : Array<vscode.CompletionItem>;
	peekCompletions : Array<vscode.CompletionItem>;
	callCompletions : Array<vscode.CompletionItem>;
	negativeAddr: boolean | undefined;
	constructor()
	{
		this.pokeCompletions = new Array<vscode.CompletionItem>();
		this.peekCompletions = new Array<vscode.CompletionItem>();
		this.callCompletions = new Array<vscode.CompletionItem>();
		this.rebuild();
	}
	rebuild()
	{
		this.pokeCompletions = new Array<vscode.CompletionItem>();
		this.peekCompletions = new Array<vscode.CompletionItem>();
		this.callCompletions = new Array<vscode.CompletionItem>();
		const config = vscode.workspace.getConfiguration('merlin6502');
		this.negativeAddr = false;
		for (const addr of Object.keys(specialAddresses))
		{
			const typ = Object(specialAddresses)[addr].type;
			const ctx = Object(specialAddresses)[addr].ctx;
			if (!config.get('completions.ibas') && ctx && ctx=="Integer BASIC")
				continue;
			if (!config.get('completions.abas') && ctx && ctx=="Applesoft")
				continue;
			if (typ && typ.search('soft switch')==-1 && typ.search('routine')==-1)
			{
				this.pokeCompletions.push(this.get_completion_item(addr,'',''));
				this.peekCompletions.push(this.get_completion_item(addr,'',''));
			}
			if (typ=='soft switch')
			{
				this.pokeCompletions.push(this.get_completion_item(addr,'',''));
				this.peekCompletions.push(this.get_completion_item(addr,'',''));
			}
			if (typ && typ.search('routine')>=0)
				this.callCompletions.push(this.get_completion_item(addr,'',''));
		}
	}
	get_completion_item(addr: string,prefix: string,postfix: string) : vscode.CompletionItem
	{
		const addr_entry = Object(specialAddresses)[addr];
		let num_addr = parseInt(addr);
		num_addr = num_addr<0 && !this.negativeAddr ? num_addr+2**16 : num_addr;
		num_addr = num_addr>=2**15 && this.negativeAddr ? num_addr-2**16 : num_addr;
		let addr_str = num_addr.toString(16);
		const config = vscode.workspace.getConfiguration('merlin6502');
		if (config.get('case.caseSensitive') || !config.get('case.lowerCaseCompletions'))
			addr_str = addr_str.toUpperCase();
		const it = { 
			description: addr_entry.brief,
			detail: addr_entry.label,
			label: prefix + addr_str + postfix
		};
		if (!it.description)
		{
			const temp = addr_entry.desc as string;
			const temp2 = temp.lastIndexOf('.')==temp.length-1 ? temp.substring(0,temp.length-1) : temp;
			it.description = temp2;
		}
		return new vscode.CompletionItem(it,vscode.CompletionItemKind.Constant);
	}
	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position)
	{
		let ans = new Array<vscode.CompletionItem>();
		let linePrefix = document.lineAt(position).text.substring(0,position.character);
		if (!vscode.workspace.getConfiguration('merlin6502').get('case.caseSensitive'))
			linePrefix = linePrefix.toUpperCase();
		if (linePrefix.search(/(EQU|=)\s+\$$/)>-1)
		{
			ans = ans.concat(this.peekCompletions);
			ans = ans.concat(this.callCompletions);
		}
		if (ans.length>0)
			return ans;
		else
			return undefined;
	}
}

export class TSCompletionProvider extends lxbase.LangExtBase implements vscode.CompletionItemProvider
{
	labelSentry: labels.LabelSentry;
	formatOnType: boolean = false;
	complMap = Object({
		'imm': '#${0:imm}',
		'abs': '${0:abs}',
		'zp': '${0:zp}',
		'rel': '${0:rel}',
		'rell': '${0:rell}',
		'absl': '${0:absl}',
		'(zp,x)': '(${1:zp},x)$0',
		'(abs,x)': '(${1:abs},x)$0',
		'(zp),y': '(${1:zp}),y$0',
		'zp,x': '${1:zp},x$0',
		'abs,x': '${1:abs},x$0',
		'absl,x': '${1:absl},x$0',
		'zp,y': '${1:zp},y$0',
		'abs,y': '${1:abs},y$0',
		'(abs)': '(${1:abs})$0',
		'(zp)': '(${1:zp})$0',
		'[d]': '[${1:d}]$0',
		'[d],y': '[${1:d}],y$0',
		'd,s': '${1:d},s$0',
		'(d,s),y': '(${1:d},s),y$0',
		'xyc': '${1:dstbnk},${0:srcbnk}',
		'impl': '',
		'accum': '',
		's': ''
	});
	widths = [9, 6, 11];
	constructor(TSInitResult : [Parser,Parser.Language], sentry: labels.LabelSentry)
	{
		super(TSInitResult);
		this.labelSentry = sentry;
		this.set_widths();
	}
	set_widths()
	{
		this.formatOnType = vscode.workspace.getConfiguration('editor').get('formatOnType') as boolean;
		this.config = vscode.workspace.getConfiguration('merlin6502');
		this.widths = [
			this.config.get('columns.c1') as number,
			this.config.get('columns.c2') as number,
			this.config.get('columns.c3') as number
		]
	}
	modify(s:string,padreq:number)
	{
		const pad = this.formatOnType ? padreq : 0;
		if (this.config.get('case.lowerCaseCompletions') && !this.config.get('case.caseSensitive'))
			return ' '.repeat(pad) + s.toLowerCase();
		else
			return ' '.repeat(pad) + s.toUpperCase();
	}
	add_label(ans: Array<vscode.CompletionItem>,a2tok: Set<string>)
	{
		a2tok.forEach(s =>
		{
			if (s[0]==':')
				ans.push(new vscode.CompletionItem({description:"local",label:s.substring(1)},vscode.CompletionItemKind.Constant));
			else if (s[0]==']')
				ans.push(new vscode.CompletionItem({description:"variable",label:s.substring(1)},vscode.CompletionItemKind.Variable));
			else
				ans.push(new vscode.CompletionItem({description:"global",label:s},vscode.CompletionItemKind.Constant));
		});
	}
	add_simple(ans: Array<vscode.CompletionItem>,a2tok: string[])
	{
		a2tok.forEach(s =>
		{
			const it = { 
				description: "",
				label: this.modify(s,0)
			};
			if (Object(opcodes)[s])
				it.description = Object(opcodes)[s].brief;
			if (Object(pseudo)[s])
				it.description = Object(pseudo)[s].brief;
			ans.push(new vscode.CompletionItem(it,vscode.CompletionItemKind.Keyword));
		});
	}
	add_args(ans: Array<vscode.CompletionItem>,op: string,pos: vscode.Position)
	{
		const req = ['6502','65c02','65c816'][this.xcCount];
		const psopInfo = Object(pseudo)[op.toLowerCase()];
		const opInfo = Object(opcodes)[op.toLowerCase()];
		const stop2 = this.widths[0] + this.widths[1];
		if (opInfo)
		{
			const modeList = opInfo.modes;
			for (const mode of modeList)
			{
				const snip = this.complMap[mode.addr_mnemonic];
				if (mode.processors.includes(req) && snip && snip.length>0)
				{
					const it = { 
						description: this.modify(op,0) + " args",
						label: this.modify(mode.addr_mnemonic,0)
					};
					ans.push(new vscode.CompletionItem(it,vscode.CompletionItemKind.Value));
					ans[ans.length-1].insertText = new vscode.SnippetString(this.modify(snip,stop2-pos.character));
				}
			}
		}
		if (psopInfo)
		{
			const args : string[] = psopInfo.enum;
			let v8x : string = psopInfo.v8x;
			let v16x : string = psopInfo.v16x;
			v8x = v8x?.substring(1,v8x.length-1);
			v16x = v16x?.substring(1,v16x.length-1);
			if (args)
			{
				args.forEach(s => {
					if (s.length>0)
					{
						const unsupported = (v8x && this.merlinVersion=='v8' && s.match(RegExp(v8x,'i'))) ||
							(v16x && this.merlinVersion=='v16' && s.match(RegExp(v16x,'i')));
						if (!unsupported)
						{
							const it = { 
								description: this.modify(op,0) + " args",
								label: this.modify(s,0)
							};
							ans.push(new vscode.CompletionItem(it, vscode.CompletionItemKind.EnumMember));
							ans[ans.length - 1].insertText = new vscode.SnippetString(this.modify(s, this.widths[1] - op.length - 1));
						}
					}
				});
			}
		}
	}
	instructionHasArguments(lst:Array<{addr_mnemonic:string,code:number,cycles:number,processors:string[]}>) : boolean
	{
		if (lst==undefined)
			return false;
		for (const it of lst)
		{
			if (['accum','impl','s'].includes(it.addr_mnemonic))
				return false;
		}
		return true;
	}
	instructionEnabled(lst:Array<string>) : boolean
	{
		if (!lst)
			return false;
		if (lst.includes('6502'))
			return true;
		else if (lst.includes('65c02') && this.xcCount>0)
			return true;
		else if (lst.includes('65c816') && this.xcCount>1)
			return true;
		return false;
	}
	pseudoOpEnabled(lst:Array<string>) : boolean
	{
		if (lst && lst.includes(this.merlinVersion))
			return true;
		return false;
	}
	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position)
	{
		this.config = vscode.workspace.getConfiguration('merlin6502');
		const ans = new Array<vscode.CompletionItem>();
		const simple = new Array<string>();
		const label = new Set<string>();

		const linePrefix = document.lineAt(position).text.substring(0,position.character);
		if (linePrefix.charAt(0)=='*')
			return undefined;
		this.GetProperties(document);
		if (linePrefix.search(/^\S*\s+[A-Za-z]$/)>-1) // start of opcode column?
		{
			for (const k of Object.keys(opcodes))
				if (this.instructionEnabled(Object(opcodes)[k].processors))
					simple.push(k);
			for (const k of Object.keys(pseudo))
				if (this.pseudoOpEnabled(Object(pseudo)[k].version))
					simple.push(k);
			for (const [k,v] of this.labelSentry.shared.macros)
				label.add(k);
		}
		if (linePrefix.search(/^:$/)>-1 || linePrefix.search(/^\S*\s+\S+\s+:$/)>-1) // pressed `:` in first or third column
		{
			for (const [k,v] of this.labelSentry.shared.locals)
				label.add(k.substring(k.indexOf('\u0100')+1));
		}
		if (linePrefix.search(/^]$/)>-1 || linePrefix.search(/^\S*\s+\S+\s+]$/)>-1) // pressed `]` in first or third column
		{
			for (const [k,v] of this.labelSentry.shared.vars)
				label.add(k);
		}
		if (linePrefix.search(/^[a-zA-Z]$/)>-1 || linePrefix.search(/^\S*\s+\S+\s+[a-zA-Z]$/)>-1) // pressed alpha in first or third column
		{
			for (const [k,v] of this.labelSentry.shared.globals)
				label.add(k);
		}
		if (linePrefix.search(/^\S*\s+\S+\s+$/)>-1) // search for (pseudo)-instruction args upon space
		{
			const match = linePrefix.match(/^\S*\s+(\S+)/);
			if (match)
			{
				this.add_args(ans,match[1],position);
			}
		}
		this.add_simple(ans,simple);
		this.add_label(ans,label);

		if (ans.length>0)
			return ans;
		else
			return undefined;
	}
}
