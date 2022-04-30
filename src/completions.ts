import * as vscode from 'vscode';
import * as specialAddresses from './specialAddresses.json';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';
import * as lxbase from './langExtBase';

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
	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext)
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
	modify(s:string)
	{
		if (this.config.get('case.lowerCaseCompletions') && !this.config.get('case.caseSensitive'))
			return s.toLowerCase();
		else
			return s.toUpperCase();
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
				label: this.modify(s)
			};
			if (Object(opcodes)[s])
				it.description = Object(opcodes)[s].brief;
			if (Object(pseudo)[s])
				it.description = Object(pseudo)[s].brief;
			ans.push(new vscode.CompletionItem(it,vscode.CompletionItemKind.Keyword));
		});
	}
	add_args(ans: Array<vscode.CompletionItem>,op: string)
	{
		const req = ['6502','65c02','65c816'][this.xcCount];
		const psopInfo = Object(pseudo)[op.toLowerCase()];
		const opInfo = Object(opcodes)[op.toLowerCase()];
		if (opInfo)
		{
			const modeList = opInfo.modes;
			for (const mode of modeList)
			{
				const snip = this.complMap[mode.addr_mnemonic];
				if (mode.processors.includes(req) && snip && snip.length>0)
				{
					const it = { 
						description: this.modify(op) + " args",
						label: this.modify(mode.addr_mnemonic)
					};
					ans.push(new vscode.CompletionItem(it,vscode.CompletionItemKind.Value));
					ans[ans.length-1].insertText = new vscode.SnippetString(this.modify(snip));
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
								description: this.modify(op) + " args",
								label: this.modify(s)
							};
							ans.push(new vscode.CompletionItem(it,vscode.CompletionItemKind.EnumMember));
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
	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext)
	{
		this.config = vscode.workspace.getConfiguration('merlin6502');
		this.GetOnlyXC(document);
		const ans = new Array<vscode.CompletionItem>();
		const simple = new Array<string>();
		const label = new Set<string>();

		const linePrefix = document.lineAt(position).text.substring(0,position.character);
		if (linePrefix.charAt(0)=='*')
			return undefined;
		this.GetLabels(document);
		if (linePrefix.search(/^\S*\s+[A-Za-z]$/)>-1) // start of opcode column?
		{
			for (const k of Object.keys(opcodes))
				if (this.instructionEnabled(Object(opcodes)[k].processors))
					simple.push(k);
			for (const k of Object.keys(pseudo))
				if (this.pseudoOpEnabled(Object(pseudo)[k].version))
					simple.push(k);
			for (const v of this.labels.macros)
				label.add(v);
		}
		if (linePrefix.search(/^:$/)>-1 || linePrefix.search(/^\S*\s+\S+\s+:$/)>-1) // pressed `:` in first or third column
		{
			for (const v of this.labels.locals)
				label.add(v.substring(v.indexOf('\u0100')+1));
		}
		if (linePrefix.search(/^]$/)>-1 || linePrefix.search(/^\S*\s+\S+\s+]$/)>-1) // pressed `]` in first or third column
		{
			for (const v of this.labels.vars)
				label.add(v);
		}
		if (linePrefix.search(/^[a-zA-Z]$/)>-1 || linePrefix.search(/^\S*\s+\S+\s+[a-zA-Z]$/)>-1) // pressed alpha in first or third column
		{
			for (const v of this.labels.globals)
				label.add(v);
		}
		if (linePrefix.search(/^\S*\s+\S+\s+$/)>-1) // search for (pseudo)-instruction args upon space
		{
			const match = linePrefix.match(/^\S*\s+(\S+)/);
			if (match)
			{
				this.add_args(ans,match[1]);
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
