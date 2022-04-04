import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import { AddressHovers } from './hoversAddresses';
import { OpcodeHovers, PseudoOpcodeHovers } from './hoversStatements';
import * as lxbase from './langExtBase';

export class TSHoverProvider extends lxbase.LangExtBase implements vscode.HoverProvider
{
	addresses = new AddressHovers();
	opcodes = new OpcodeHovers();
	pseudo = new PseudoOpcodeHovers();
	hover = new Array<vscode.MarkdownString>();
	position = new vscode.Position(0,0);
	range = new vscode.Range(new vscode.Position(0,0),new vscode.Position(0,0));

	parse_merlin_number(num_str:string) : number
	{
		if (num_str[0]=='$')
			return parseInt(num_str.substring(1),16);
		if (num_str[0]=='%')
			return parseInt(num_str.substring(1),2);
		return parseInt(num_str);
	}
	addr_hover(hover:Array<vscode.MarkdownString>,curs:Parser.TreeCursor) : boolean
	{
		if (curs.nodeType=="number")
		{
			let display = false;
			// is this an address operand?
			const mode = curs.currentNode().parent;
			if (mode && mode.type.substring(0,4)=="addr")
				display = true;
			// is this an equate?
			const prev = curs.currentNode().previousNamedSibling;
			if (prev && prev.type=="psop_equ")
				display = true;
			if (display)
			{
				let parsed = this.parse_merlin_number(curs.nodeText);
				if (!isNaN(parsed))
				{
					if (parsed>=2**15)
						parsed = parsed - 2**16;
					const temp = this.addresses.get(parsed);
					if (temp)
					{
						temp.forEach(s => hover.push(s));
						return true;
					}
				}
			}
		}
		return false;
	}
	get_hover(curs:Parser.TreeCursor) : lxbase.WalkerChoice
	{
		this.range = this.curs_to_range(curs);
		if (this.range.contains(this.position))
		{
			if (this.config.get('hovers.specialAddresses'))
				if (this.addr_hover(this.hover,curs))
					return lxbase.WalkerOptions.exit;
			if (this.config.get('hovers.mnemonics'))
			{
				const temp = this.opcodes.get(curs.nodeType);
				if (temp)
				{
					temp.forEach(s => this.hover.push(s));
					return lxbase.WalkerOptions.exit;
				}
			}
			if (this.config.get('hovers.pseudo'))
			{
				const temp = this.pseudo.get(curs.nodeType);
				if (temp)
				{
					temp.forEach(s => this.hover.push(s));
					return lxbase.WalkerOptions.exit;
				}
			}
			if (curs.nodeType=='dstring')
			{
				if (curs.nodeText.charCodeAt(0)<"'".charCodeAt(0))
					this.hover.push(new vscode.MarkdownString('negative ASCII dstring'));
				else
					this.hover.push(new vscode.MarkdownString('positive ASCII dstring'));
				return lxbase.WalkerOptions.exit;
			}
			return lxbase.WalkerOptions.gotoChild;
		}
		return lxbase.WalkerOptions.gotoChild;
	}
	provideHover(document:vscode.TextDocument,position: vscode.Position,token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover>
	{
		this.hover = new Array<vscode.MarkdownString>();
		this.position = position;
		const tree = this.parse(document.getText(),"\n");
		this.walk(tree,this.get_hover.bind(this));
		if (this.hover.length>0)
			return new vscode.Hover(this.hover,this.range);
		else
			return undefined;
	}
}