import * as vsserv from 'vscode-languageserver/node';
import * as vsdoc from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { AddressHovers } from './hoversAddresses';
import { OpcodeHovers, PseudoOpcodeHovers } from './hoversStatements';
import * as lxbase from './langExtBase';
import * as labels from './labels';
import { relativeToWorkspace } from './workspace';
import { merlin6502Settings } from './settings';

function MarkdownString(s: string): vsserv.MarkupContent
{
	return { kind: 'markdown', value: s };
}

export class HoverProvider extends lxbase.LangExtBase
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
	constructor(TSInitResult : [Parser,Parser.Language], logger: lxbase.Logger, settings: merlin6502Settings, sentry: labels.LabelSentry)
	{
		super(TSInitResult,logger,settings);
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
	num_to_addr_hover(hover: Array<vsserv.MarkupContent>, num: number | undefined) : boolean
	{
		if (!num)
			return false;
		if (!isNaN(num))
		{
			const temp = this.addresses.get(num);
			if (temp) {
				for (let i = 0; i < temp.length; i++)
					for (let j = 0; j < temp[i].length; j++)
						hover.push(temp[i][j]);
				return true;
			}
		}
		return false;
	}
	curs_to_addr_hover(hover:Array<vsserv.MarkupContent>,curs:Parser.TreeCursor) : boolean
	{
		if (curs.nodeType=="num")
		{
			const parsed = this.parse_merlin_number(curs.nodeText);
			return this.num_to_addr_hover(hover,parsed)
		}
		return false;
	}
	append_doc_str(doc: vsserv.TextDocumentItem, rng: vsserv.Range) {
		const lines = doc.text.split(/\r?\n/);
		let count = 0;
		for (let i = rng.start.line - 1; i >= 0; i--) {
			if (lines[i].charAt(0) == "*")
				count++;
			else
				break;
		}
		let docString = "";
		for (let i = rng.start.line - count; i < rng.start.line; i++) {
			docString += lines[i].substring(1) + "\n";
		}
		if (docString.length > 0)
			this.hover.push(MarkdownString(docString));
	}
	get_hover(curs:Parser.TreeCursor) : lxbase.WalkerChoice
	{
		this.range = lxbase.curs_to_range(curs,this.row,this.col);
		if (lxbase.rangeContainsPos(this.range,this.position))
		{
			if (this.config.hovers.specialAddresses)
				if (this.curs_to_addr_hover(this.hover,curs))
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
			if (curs.nodeType == 'macro_ref') {
				let nodes = this.labelSet?.macros.get(curs.nodeText);
				if (nodes)
					for (const node of nodes)
						if (lxbase.rangeContainsRange(node.rng, lxbase.curs_to_range(curs, this.row, this.col))) {
							this.hover.push(MarkdownString("```\n" + node.expanded_mac + "```"));
							return lxbase.WalkerOptions.exit;
						}
				this.hover.push(MarkdownString("expansion not found"));
				return lxbase.WalkerOptions.exit;
			}
			if (curs.nodeType=='label_ref' && curs.currentNode().firstChild?.type=='global_label')
			{
				if (!this.labelSet)
					return lxbase.WalkerOptions.exit;
				const pos_key = this.labelSet.encode_rng(this.range)
				if (this.labelSet.macro_locals_pos.has(pos_key)) {
					this.hover.push(MarkdownString("scoped to macro "+this.labelSet.macro_locals_pos.get(pos_key)));
					return lxbase.WalkerOptions.exit;
				}
				let nodes = this.labelSet.globals.get(curs.nodeText);
				if (!nodes)
					return lxbase.WalkerOptions.exit;
				for (const node of nodes)
				{
					if (node.isDef)
					{
						if (this.config.hovers.specialAddresses)
							this.num_to_addr_hover(this.hover,node.value);
						const row = node.rng.start.line
						let str = 'definition on line ' + (row+1);
						if (this.currDoc && this.currDoc.uri == node.doc.uri)
						{
							str += '\n```\n' + this.currDoc.text.split(/\r?\n/)[row] + '\n```';
							this.hover.push(MarkdownString(str));
							this.append_doc_str(this.currDoc, node.rng);
						}
						else
						{
							str += '\n\nof ' + relativeToWorkspace(this.labelSentry.context.folders,node.doc.uri);
							str += '\n```\n' + node.doc.text.split(/\r?\n/)[row] + '\n```';
							this.hover.push(MarkdownString(str));
							this.append_doc_str(node.doc, node.rng);
						}
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
					if (this.labelSet) {
						const pos_key = this.labelSet.encode_rng(this.range);
						if (this.labelSet.macro_locals_pos.has(pos_key)) {
							this.hover.push(MarkdownString("scoped to macro "+this.labelSet.macro_locals_pos.get(pos_key)));
							return lxbase.WalkerOptions.exit;
						}
						this.hover.push(MarkdownString('global defined right here'));
						const entries = this.labelSentry.context.entries.get(curs.nodeText);
						if (!entries)
							return lxbase.WalkerOptions.exit;
						for (const node of entries) {
							const row = node.rng.start.line
							if (node.doc) {
								if (node.doc == this.currDoc)
									this.hover.push(MarkdownString('entry found on line ' + (row + 1) +
										'\n```\n' + node.doc.text.split(/\r?\n/)[row] + '\n```'));
								else
									this.hover.push(MarkdownString('entry found in file\n\n' +
										relativeToWorkspace(this.labelSentry.context.folders, node.doc.uri) +
										'\n\non line ' + (row + 1) +
										'\n```\n' + node.doc.text.split(/\r?\n/)[row] + '\n```'));
							}
						}
					} else {
						this.hover.push(MarkdownString('label data not found'));
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
		this.lines = document.getText().split(/\r?\n/);
		this.labelSet = test; 
		this.currDoc = vsserv.TextDocumentItem.create(document.uri,'merlin6502',document.version,document.getText());
		if (!this.currDoc)
			return undefined;
		this.hover = new Array<vsserv.MarkupContent>();
		this.position = position;
		this.GetProperties(this.lines);
		for (this.row=0;this.row<this.lines.length;this.row++)
		{
			const tree = this.parse(this.AdjustLine(this.lines,this.labelSet.macros),"\n");
			this.walk(tree,this.get_hover.bind(this),undefined);
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
