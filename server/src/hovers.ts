import * as vsserv from 'vscode-languageserver/node';
import * as vsdoc from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { AddressHovers } from './hoversAddresses';
import { OpcodeHovers, PseudoOpcodeHovers } from './hoversStatements';
import * as lxbase from './langExtBase';
import * as labels from './labels';
import { merlin6502Settings } from './settings';

function MarkdownString(s: string): vsserv.MarkupContent
{
	return { kind: 'markdown', value: s };
}

export class TSHoverProvider extends lxbase.LangExtBase
{
	labelSentry: labels.LabelSentry;
	labelSet: labels.LabelSet | undefined;
	addresses = new AddressHovers();
	opcodes = new OpcodeHovers();
	pseudo = new PseudoOpcodeHovers();
	hover = new Array<vsserv.MarkupContent>();
	position = vsserv.Position.create(0,0);
	range = vsserv.Range.create(0,0,0,0);
	currDoc: vsserv.TextDocumentItem | null = null;
	lines: string[] = [];
	constructor(TSInitResult : [Parser,Parser.Language], settings: merlin6502Settings, sentry: labels.LabelSentry)
	{
		super(TSInitResult,settings);
		this.labelSentry = sentry;
	}

	parse_merlin_number(num_str:string) : number
	{
		if (num_str[0]=='$')
			return parseInt(num_str.substring(1),16);
		if (num_str[0]=='%')
			return parseInt(num_str.substring(1),2);
		return parseInt(num_str);
	}
	addr_hover(hover:Array<vsserv.MarkupContent>,curs:Parser.TreeCursor) : boolean
	{
		if (curs.nodeType=="num")
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
		return false;
	}
	get_hover(curs:Parser.TreeCursor) : lxbase.WalkerChoice
	{
		this.range = lxbase.curs_to_range(curs,this.row,this.col);
		if (lxbase.rangeContainsPos(this.range,this.position))
		{
			if (this.config.hovers.specialAddresses)
				if (this.addr_hover(this.hover,curs))
					return lxbase.WalkerOptions.exit;
			if (this.config.hovers.mnemonics)
			{
				const temp = this.opcodes.get(curs.nodeType);
				if (temp)
				{
					temp.forEach(s => this.hover.push(s));
					return lxbase.WalkerOptions.exit;
				}
			}
			if (this.config.hovers.pseudo)
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
					this.hover.push(MarkdownString('negative ASCII dstring'));
				else
					this.hover.push(MarkdownString('positive ASCII dstring'));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType == 'nchar') {
				this.hover.push(MarkdownString('negative ASCII character'));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType == 'pchar') {
				this.hover.push(MarkdownString('positive ASCII character'));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType == 'data_prefix') {
				this.hover.push(MarkdownString('data prefix. `<` or `#<` = lo-byte, `>` or `#>` = hi-byte (default)\n\n`#` does nothing.'));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType == 'imm_prefix' && this.merlinVersion=='v8') {
				this.hover.push(MarkdownString(
'immediate mode, the operand is a number, not an address\n\n\
`#` or `#<` = lo-byte, `#>` = hi-byte'));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType == 'imm_prefix' && this.merlinVersion!='v8') {
				this.hover.push(MarkdownString(
'immediate mode, the operand is a number, not an address\n\n\
`#` or `#<` = lo-byte/word, `#>` = hi-byte/word, `#^` = bank byte'));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType == 'addr_prefix') {
				this.hover.push(MarkdownString('address modifier, `<` = lo-byte, `>` = lo-word, `^` = hi-word, `|` = 24-bits'));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType == 'num_str_prefix') {
				this.hover.push(MarkdownString(
"number prefix, the expression's value is converted to text\n\n\
`#` or `#'` = positive ASCII, `#\"` = negative ASCII\n\n\
add `>` to right justify in 5 column field, e.g. `#'>`"));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType=='label_ref' && curs.currentNode().firstChild?.type=='global_label' || curs.nodeType=='macro_ref')
			{
				let nodes = this.labelSet?.globals.get(curs.nodeText);
				if (!nodes)
					nodes = this.labelSet?.macros.get(curs.nodeText);
				if (!nodes)
					return lxbase.WalkerOptions.exit;
				for (const node of nodes)
				{
					if (node.isDef)
					{
						const row = node.rng.start.line
						let str = 'definition on line ' + (row+1);
						if (this.currDoc && this.currDoc.uri == node.doc.uri)
							str += '\n```\n' + this.currDoc.text.split('\n')[row] + '\n```';
						else
						{
							str += '\n\nof ' + lxbase.relativeToWorkspace(this.labelSentry.workspaceFolders,node.doc.uri);
							str += '\n```\n' + node.doc.text.split('\n')[row] + '\n```';
						}
						this.hover.push(MarkdownString(str));
					}
				}
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType == 'macro_def') {
				this.hover.push(MarkdownString('macro defined right here'));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType=='label_def')
			{
				const inner = curs.currentNode().firstChild?.type;
				if (inner == 'local_label') {
					this.hover.push(MarkdownString('local defined right here'));
					return lxbase.WalkerOptions.exit;
				} else if (inner == 'var_label') {
					this.hover.push(MarkdownString('variable defined right here'));
					return lxbase.WalkerOptions.exit;
				} else if (inner == 'global_label') {
					this.hover.push(MarkdownString('global defined right here'));
					// const next = curs.currentNode().nextNamedSibling;
					const entries = this.labelSentry.entries.get(curs.nodeText);
					if (!entries)
						return lxbase.WalkerOptions.exit;
					// if (next && next.type == 'psop_ent')
					// 	return lxbase.WalkerOptions.exit;
					for (const node of entries) {
						const row = node.rng.start.line
						if (node.doc) {
							if (node.doc == this.currDoc)
								this.hover.push(MarkdownString('entry found on line ' + (row + 1) +
									'\n```\n' + node.doc.text.split('\n')[row] + '\n```'));
							else
								this.hover.push(MarkdownString('entry found in file\n\n' +
									lxbase.relativeToWorkspace(this.labelSentry.workspaceFolders, node.doc.uri) +
									'\n\non line ' + (row + 1) +
									'\n```\n' + node.doc.text.split('\n')[row] + '\n```'));
						}
					}
				}
				return lxbase.WalkerOptions.exit;
			}
			return lxbase.WalkerOptions.gotoChild;
		}
		return lxbase.WalkerOptions.gotoChild;
	}
	provideHover(document:vsdoc.TextDocument | undefined,position: vsserv.Position): vsserv.Hover | undefined
	{
		if (!document)
			return undefined;
		const test = this.labelSentry.shared.get(document.uri);
		if (!test)
			return undefined;
		this.lines = document.getText().split('\n');
		this.labelSet = test; 
		this.currDoc = this.labelSentry.currMain;
		if (!this.currDoc)
			return undefined;
		this.hover = new Array<vsserv.MarkupContent>();
		this.position = position;
		this.GetProperties(this.lines);
		for (this.row=0;this.row<this.lines.length;this.row++)
		{
			const tree = this.parse(this.AdjustLine(this.lines,this.labelSet.macros),"\n");
			this.walk(tree,this.get_hover.bind(this));
			if (this.hover.length > 0) {
				const content: string[] = [];
				this.hover.forEach(h => {
					content.push(h.value);
				});
				return { contents: content.join('\n\n---\n\n'), range: this.range };
			}
		}
		this.currDoc = null;
		return undefined;
	}
}
