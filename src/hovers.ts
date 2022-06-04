import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import { AddressHovers } from './hoversAddresses';
import { OpcodeHovers, PseudoOpcodeHovers } from './hoversStatements';
import { sharedLabels } from './extension';
import * as lxbase from './langExtBase';

export class TSHoverProvider extends lxbase.LangExtBase implements vscode.HoverProvider
{
	addresses = new AddressHovers();
	opcodes = new OpcodeHovers();
	pseudo = new PseudoOpcodeHovers();
	hover = new Array<vscode.MarkdownString>();
	position = new vscode.Position(0,0);
	range = new vscode.Range(new vscode.Position(0,0),new vscode.Position(0,0));
	currDoc : vscode.TextDocument | null = null;

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
		this.range = this.curs_to_range(curs,this.row,this.col);
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
			if (curs.nodeType=='label_ref' && curs.currentNode().firstChild?.type=='global_label')
			{
				let nodes = sharedLabels.globals.get(curs.nodeText);
				if (!nodes)
					nodes = sharedLabels.macros.get(curs.nodeText);
				if (!nodes)
					return lxbase.WalkerOptions.exit;
				for (const node of nodes)
				{
					if (node.isDef)
					{
						const row = node.rng.start.line
						let str = 'definition on line ' + (row+1);
						if (this.currDoc && node.doc==null)
							str += '\n```\n' + this.currDoc.lineAt(row).text + '\n```';
						if (node.doc!=null)
						{
							str += '\n\nof ' + vscode.workspace.asRelativePath(node.doc.uri);
							str += '\n```\n' + node.doc.lineAt(row).text + '\n```';
						}
						this.hover.push(new vscode.MarkdownString(str));
					}
				}
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType=='label_def' && curs.currentNode().firstChild?.type=='global_label')
			{
				const next = curs.currentNode().nextNamedSibling;
				const entries = sharedLabels.entries.get(curs.nodeText);
				this.hover.push(new vscode.MarkdownString('defined right here'));
				if (!entries)
					return lxbase.WalkerOptions.exit;
				if (next && next.type=='psop_ent')
					return lxbase.WalkerOptions.exit;
				for (const node of entries)
				{
					const row = node.rng.start.line
					if (node.doc) {
						if (node.doc == this.currDoc)
							this.hover.push(new vscode.MarkdownString('entry found on line '+(row+1)).
								appendCodeblock(node.doc.lineAt(row).text));
						else
							this.hover.push(new vscode.MarkdownString('entry found in file\n\n').
								appendText(vscode.workspace.asRelativePath(node.doc.uri)).
								appendText('\n\non line '+(row+1)).
								appendCodeblock(node.doc.lineAt(row).text));
					}
				}
				return lxbase.WalkerOptions.exit;
			}
			return lxbase.WalkerOptions.gotoChild;
		}
		return lxbase.WalkerOptions.gotoChild;
	}
	provideHover(document:vscode.TextDocument,position: vscode.Position): vscode.ProviderResult<vscode.Hover>
	{
		this.currDoc = document;
		this.hover = new Array<vscode.MarkdownString>();
		this.position = position;
		this.GetProperties(document);
		for (this.row=0;this.row<document.lineCount;this.row++)
		{
			const tree = this.parse(this.AdjustLine(document,sharedLabels.macros),"\n");
			this.walk(tree,this.get_hover.bind(this));
			if (this.hover.length>0)
				return new vscode.Hover(this.hover,this.range);
		}
		this.currDoc = null;
		return undefined;
	}
}