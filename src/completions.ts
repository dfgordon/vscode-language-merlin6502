import * as vscode from 'vscode';
import * as specialAddresses from './specialAddresses.json';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';

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
		for (const addr in specialAddresses)
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
		if (vscode.workspace.getConfiguration('merlin6502').get('case.caseSensitive'))
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
		if (linePrefix.search(/EQU\s+\$$/)>-1)
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

export class TSCompletionProvider implements vscode.CompletionItemProvider
{
	config : vscode.WorkspaceConfiguration;
	constructor()
	{
		this.config = vscode.workspace.getConfiguration('merlin6502');
	}
	modify(s:string)
	{
		if (this.config.get('case.lowerCaseCompletions') && !this.config.get('case.caseSensitive'))
			return s.toLowerCase();
		else
			return s.toUpperCase();
	}
	add_simple(ans: Array<vscode.CompletionItem>,a2tok: string[])
	{
		a2tok.forEach(s =>
		{
			let it = { 
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
	add_procs(ans: Array<vscode.CompletionItem>,a2tok: string[],expr_typ: string)
	{
		a2tok.forEach(s =>
		{
			let it = { 
				description: "",
				label: this.modify(s) + ' ' + expr_typ
			};
			if (Object(opcodes)[s])
				it.description = Object(opcodes)[s].brief;
			if (Object(pseudo)[s])
				it.description = Object(pseudo)[s].brief;
			ans.push(new vscode.CompletionItem(it,vscode.CompletionItemKind.Keyword));
			ans[ans.length-1].insertText = new vscode.SnippetString(this.modify(s)+'\t${0}');
		});
	}
	analyzeAddressingModes(lst:Array<any>) : boolean
	{
		for (var it in lst)
		{
			if (['accum','impl','s'].indexOf(lst[it].addr_mnemonic)==-1)
				return true;
		}
		return false;
	}
	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext)
	{
		this.config = vscode.workspace.getConfiguration('merlin6502');
		const ans = new Array<vscode.CompletionItem>();
		const procs = new Array<string>();
		const simple = new Array<string>();

		let linePrefix = document.lineAt(position).text.substring(0,position.character);
		if (linePrefix.search(/^[^ \t]*[ \t]+[A-Za-z]+$/)>-1) // start of opcode column?
		{
			for (var it in opcodes)
			{
				if (this.analyzeAddressingModes(Object(opcodes)[it].modes))
					procs.push(it);
				else
					simple.push(it);
			}
			for (var it in pseudo)
			{
				if (Object(pseudo)[it].args || Object(pseudo)[it].args16)
					procs.push(it);
				else
					simple.push(it);
			}
			this.add_simple(ans,simple);
			this.add_procs(ans,procs,'operand');
		}

		if (ans.length>0)
			return ans;
		else
			return undefined;
	}
}
