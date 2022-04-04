import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';

const tokenTypes = [
	'comment', 'string', 'keyword', 'number', 'regexp', 'operator', 'namespace',
	'type', 'struct', 'class', 'interface', 'enum', 'typeParameter', 'function',
	'method', 'decorator', 'macro', 'variable', 'parameter', 'property', 'label'
];
const tokenModifiers = [
	'declaration', 'documentation', 'readonly', 'static', 'abstract', 'deprecated',
	'modification', 'async'
];

export const legend = new vscode.SemanticTokensLegend(tokenTypes,tokenModifiers);

export class TSSemanticTokensProvider extends lxbase.LangExtBase implements vscode.DocumentSemanticTokensProvider
{
	tokensBuilder : vscode.SemanticTokensBuilder = new vscode.SemanticTokensBuilder(legend);
	process_node(curs: Parser.TreeCursor): lxbase.WalkerChoice
	{
		const rng = this.curs_to_range(curs);
		if (["global_label","current_addr"].indexOf(curs.nodeType)>-1)
		{
			this.tokensBuilder.push(rng,"macro",[]);
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType=="local_label")
		{
			this.tokensBuilder.push(rng,"parameter",[]);
			return lxbase.WalkerOptions.gotoChild;
		}
		if (curs.nodeType=="var_label")
		{
			this.tokensBuilder.push(rng,"variable",[]);
			return lxbase.WalkerOptions.gotoChild;
		}
		if (["main_comment","comment"].indexOf(curs.nodeType)>-1) // must precede statement handler
		{
			this.tokensBuilder.push(rng,"comment",[]);
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType.slice(0,4)=="eop_")
		{
			this.tokensBuilder.push(rng,"operator",[]);
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType.slice(0,3)=="op_")
		{
			this.tokensBuilder.push(rng,"keyword",[]);
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType.slice(0,5)=="mode_")
		{
			this.tokensBuilder.push(rng,"keyword",[]);
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType=="imm_prefix")
		{
			this.tokensBuilder.push(rng,"keyword",[]);
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType.slice(0,5)=="psop_")
		{
			this.tokensBuilder.push(rng,"function",[]);
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (["dstring","pchar","nchar","literal_arg","literal","filename"].indexOf(curs.nodeType)>-1)
		{
			this.tokensBuilder.push(rng,"string",[]);
			return lxbase.WalkerOptions.gotoSibling;
		}
		if (curs.nodeType=="number")
		{
			this.tokensBuilder.push(rng,"number",[]);
			return lxbase.WalkerOptions.gotoSibling;
		}
		return lxbase.WalkerOptions.gotoChild;
	}
	provideDocumentSemanticTokens(document:vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens>
	{
		this.tokensBuilder = new vscode.SemanticTokensBuilder(legend);

		const tree = this.parse(document.getText(),"\n");
		this.walk(tree,this.process_node.bind(this));
		return this.tokensBuilder.build();
	}
}