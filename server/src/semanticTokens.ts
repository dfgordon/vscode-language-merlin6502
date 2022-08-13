import * as vsserv from 'vscode-languageserver';
import * as vsdoc from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';
import * as labels from './labels';
import { merlin6502Settings } from './settings';

export const legend : vsserv.SemanticTokensLegend = {
	tokenTypes: [
		'comment', 'string', 'keyword', 'number', 'regexp', 'operator', 'namespace',
		'type', 'struct', 'class', 'interface', 'enum', 'typeParameter', 'function',
		'method', 'decorator', 'macro', 'variable', 'parameter', 'property', 'label'
	],
	tokenModifiers: [
		'declaration', 'documentation', 'readonly', 'static', 'abstract', 'deprecated',
		'modification', 'async'
	]
};

function tokType(typ: string) : [number,number] {
	// n.b. modifier code is a bitmap, while type code is an array index
	return [legend.tokenTypes.indexOf(typ), 0];
}

export class TokenProvider extends lxbase.LangExtBase
{
	labelSentry: labels.LabelSentry;
	tokensBuilder : vsserv.SemanticTokensBuilder = new vsserv.SemanticTokensBuilder();

	constructor(TSInitResult : [Parser,Parser.Language], settings: merlin6502Settings, sentry: labels.LabelSentry)
	{
		super(TSInitResult,settings);
		this.labelSentry = sentry;
	}
	process_node(curs: Parser.TreeCursor): lxbase.WalkerChoice
	{
		const rng = lxbase.curs_to_range(curs, this.row, this.col);
		const pos : [number,number,number] = [rng.start.line, rng.start.character, rng.end.character - rng.start.character];
		if (curs.currentFieldName()=='mac')
		{
			this.tokensBuilder.push(...pos,...tokType('macro'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (["global_label","current_addr"].includes(curs.nodeType))
		{
			this.tokensBuilder.push(...pos,...tokType('enum'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType=="local_label")
		{
			this.tokensBuilder.push(...pos,...tokType('parameter'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType=="var_label")
		{
			this.tokensBuilder.push(...pos,...tokType('variable'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (["main_comment","comment"].includes(curs.nodeType))
		{
			this.tokensBuilder.push(...pos,...tokType('comment'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType.slice(0,4)=="eop_")
		{
			this.tokensBuilder.push(...pos,...tokType('operator'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType.slice(0,3)=="op_")
		{
			this.tokensBuilder.push(...pos,...tokType('keyword'));
			return lxbase.WalkerOptions.gotoChild;
		}
		if (curs.nodeType.slice(0,5)=="mode_")
		{
			this.tokensBuilder.push(...pos,...tokType('keyword'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (["imm_prefix","addr_prefix","num_str_prefix"].includes(curs.nodeType))
		{
			this.tokensBuilder.push(...pos,...tokType('keyword'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType.slice(0,5)=="psop_")
		{
			this.tokensBuilder.push(...pos,...tokType('function'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (["dstring","pchar","nchar","literal_arg","literal","filename","trailing"].indexOf(curs.nodeType)>-1)
		{
			this.tokensBuilder.push(...pos,...tokType('string'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (["number","hex_data"].indexOf(curs.nodeType)>-1)
		{
			this.tokensBuilder.push(...pos,...tokType('number'));
			return lxbase.WalkerOptions.gotoSibling;
		}
		return lxbase.WalkerOptions.gotoChild;
	}

	provideDocumentRangeSemanticTokens(document:vsdoc.TextDocument,range: vsserv.Range): vsserv.SemanticTokens | null
	{
		const macros = this.labelSentry.shared.get(document.uri)?.macros;
		if (!macros)
			return null;
		const lines = document.getText().split('\n');
		this.tokensBuilder = new vsserv.SemanticTokensBuilder();
		this.GetProperties(lines);
		if (this.interpretation=='linker')
			return null;
		for (this.row=range.start.line;this.row<=range.end.line;this.row++)
		{
			const tree = this.parse(this.AdjustLine(lines,macros),"\n");
			this.walk(tree,this.process_node.bind(this));
		}
		return this.tokensBuilder.build();
	}

	provideDocumentSemanticTokens(document:vsdoc.TextDocument): vsserv.SemanticTokens | null
	{
		const macros = this.labelSentry.shared.get(document.uri)?.macros;
		if (!macros)
			return null;
		const lines = document.getText().split('\n');
		this.tokensBuilder = new vsserv.SemanticTokensBuilder();
		this.GetProperties(lines);
		if (this.interpretation=='linker')
			return null;
		for (this.row=0;this.row<lines.length;this.row++)
		{
			const tree = this.parse(this.AdjustLine(lines,macros),"\n");
			this.walk(tree,this.process_node.bind(this));
		}
		return this.tokensBuilder.build();
	}
}